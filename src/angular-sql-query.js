// @ts-check

(function iife(angular) {
  'use strict';

  const PARAMS_LIMIT = 100;
  const NB_PARAMS_MAX = 300;

  angular
    .module('sf.sqlQuery', [])
    .factory('SqlQueryService', SqlQueryService);


  /**
   * @typedef {Record<string, any>} Resource
   * 
   * @typedef  SQLQueryOptions
   * @property {string[]}       [indexed_fields] -
   * 
   * @typedef  {Record<string, any>} FiltersParameters
   * @typedef  {Record<string, Exclude<any, boolean|undefined>>} SanitizedFiltersParameters
   * 
   * @typedef  LimitParameters
   * @property {number} [limit]
   * @property {number} [offset]
   * 
   * @typedef  SortParameter
   * @property {string}   key
   * @property {boolean}  [desc]
   * 
   * @typedef  QueryObject
   * @property {string} query
   * @property {any[]}  [params]
   
   * @typedef  {QueryObject[]} QuerySequence
   * 
   * @typedef  QueryPartition
   * @property {FiltersParameters} self
   * @property {FiltersParameters} ext
   */

  // @ngInject
  /**
   * @param   {ng.ILogService}  $log  -
   * @param   {ng.IQService}    $q    -
   * @returns {*}                     -
   */
  function SqlQueryService($log, $q) {
    /**
     * @param   {string}          tableName   -
     * @param   {Function}        databaseFn  -
     * @param   {SQLQueryOptions} options     -
     * @returns {SqlQuery}                    -
     */
    function SqlQuery(tableName, databaseFn, options = {}) {
      const indexedFields = options.indexed_fields || [];

      this.options = options;
      this.backUpName = tableName;
      this.helpers = { indexed_fields: indexedFields };

      this.backUpDB = backUpDB;

      return this;

      /**
       * @returns {ng.IPromise<Database>} -
       */
      function backUpDB() {
        return databaseFn();
      }
    }

    // Methods
    // (mimic a class implementation)
    SqlQuery.prototype.getBackUp = getBackUp;
    SqlQuery.prototype.listBackUp = listBackUp;
    SqlQuery.prototype.queryBackUp = queryBackUp;
    SqlQuery.prototype.saveBackUp = saveBackUp;
    SqlQuery.prototype.updateBackUp = updateBackUp;
    SqlQuery.prototype.removeBackUp = removeBackUp;
    SqlQuery.prototype.removeQueryBackUp = removeQueryBackUp;
    SqlQuery.prototype.bulkDocsBackUp = bulkDocsBackUp;
    SqlQuery.prototype.execute = execute;
    SqlQuery.prototype.batch = batch;


    // -----------------
    //
    //  GET Methods
    //
    // -----------------

    /**
     * Request a list of datas
     *
     * @param  {LimitParameters}    limitParams -
     * @return {ng.IPromise<any[]>}             - Array of unserialized values
     * @this   {SqlQuery}
     */
    function listBackUp(limitParams) {
      const _this = this;
      const request = prepareSelect(_this.backUpName, {}, limitParams);

      return this.execute(request.query)
        .then(transformResults)
        .catch((err) => {
          $log.error('[Backup] List', _this.backUpName, ':', err.message);
          throw err;
        });
    }

    /**
     * @param  {string}                entryId -
     * @return {ng.IPromise<Resource>}         -
     * @this   {SqlQuery}
     */
    function getBackUp(entryId) {
      if(!entryId) {
        throw new Error('FiltersParameters need filter');
      }

      const _this = this;
      const request = prepareSelect(_this.backUpName, { id: entryId });

      return this.execute(request.query, request.params)
        .then(doc => (doc.rows.length) ?
          unserializePayloadColumn(doc, 0) :
          $q.reject({ message: 'Not Found', status: 404 }))
        .catch((err) => {
          $log.error('[Backup] Get', _this.backUpName, ':', err.message);
          throw err;
        });
    }

    /**
     * Make a request by params
     *
     * SELECT * FROM dbName WHERE blop=? AND id IN (?,?,?,...) AND blip=?;
     * SELECT * FROM dbName db, tmpName tmp WHERE blop=? AND db.id=tmp.id AND blip=?;
     *
     * @param  {FiltersParameters} [filtersParams={}]  -
     * @param  {LimitParameters}   [limitParams={}]    -
     * @param  {SortParameter[]}   [sortParams=[]]     -
     * @return {ng.IPromise<Resource[]>}               -
     * @this   {SqlQuery}
     */
    function queryBackUp(filtersParams = {}, limitParams = {}, sortParams = []) {
      const _this = this;
      const indexedFields = _this.helpers.indexed_fields;

      // filtersParams 
      // |> sanitizeFiltersValues - remove boolean values
      // |> pickIndexed           - keep only indexed cols related filters
      // |> partitionByQuerySize  - split high sized filtervalues
      const sanitizedFiltersParams = sanitizeFiltersValues(filtersParams);
      const indexedFiltersParams = pickIndexed(indexedFields, sanitizedFiltersParams);
      const partitionnedFiltersParams = partitionByQuerySize(indexedFiltersParams);
      const tmpQueries = buildInsertTmpTablesQueries(
        _this.backUpName,
        partitionnedFiltersParams
      );
      const tmpTablesQueries = tmpQueries.reduce((arr, queries) => arr.concat(queries), []);

      // building the temp tables if needed
      const batchPromise = (tmpTablesQueries.length) ?
        _this.batch(tmpTablesQueries) :
        $q.when();

      return batchPromise
        .then(() => {
          var query = prepareSimpleQuery(
            _this.backUpName,
            partitionnedFiltersParams,
            limitParams,
            sortParams
          );

          return _this.execute(query.query, query.params)
            .then((docs) => {
              const datas = transformResults(docs);
              const nonIndexedParams = pickNonIndexed(indexedFields, sanitizedFiltersParams);

              return inMemoryFilter(datas, nonIndexedParams);
            });
        })
        .catch((err) => {
          $log.error('[Backup] Query', _this.backUpName, ':', err.message);
          throw err;
        });

      /**
       * Split the filtering queries into 2 categories
       * What is contained in self will be runned agains the whole table
       * What is contained in ext will use another temp table in order to bypass the limit
       * 
       * @param   {FiltersParameters} filterParams -
       * @returns {QueryPartition}                 -
       */
      function partitionByQuerySize(filterParams) {
        const valueSizeTooBig = value => angular.isArray(value) &&
          PARAMS_LIMIT < value.length;

        return Object.keys(filterParams)
          .reduce(
            (partition, columnName) => {
              const value = filterParams[columnName];

              partition[valueSizeTooBig(value) ? 'ext' : 'self'][columnName] = value;
              return partition;
            },
            { self: {}, ext: {} }
          );
      }

      /**
       * @param   {string}         tableName              -
       * @param   {QueryPartition} filtersParamsPartition -
       * @returns {QuerySequence[]}                       -
       */
      function buildInsertTmpTablesQueries(tableName, filtersParamsPartition) {
        return Object.keys(filtersParamsPartition.ext)
          .map((key) => {
            const cTmpName = `tmp_${tableName}_${key}`;
            const dropTableQuery = `DROP TABLE IF EXISTS ${cTmpName}`;
            const createTableQuery = `CREATE TABLE IF NOT EXISTS ${cTmpName} (value TEXT)`;
            const insertQueries = buildInsertQueries(
              cTmpName, 'value', filtersParamsPartition.ext[key]);

            return [
              { query: dropTableQuery },
              { query: createTableQuery },
            ].concat(insertQueries);
          });
      }

      /**
       * @param   {string} tableName    -
       * @param   {string} column       -
       * @param   {any[]}  filterValues - 
       * @returns {QuerySequence}       -
       */
      function buildInsertQueries(tableName, column, filterValues) {
        return chunck(filterValues, NB_PARAMS_MAX)
          .map((fvChunck) => {
            const query = `INSERT INTO ${tableName}`;
            const sliceQuery = prepareInsertUnionQuery(fvChunck, column);

            return {
              query: `${query} ${sliceQuery}`,
              params: fvChunck,
            };
          });
      }
    }

    // -----------------
    //
    //  Modify Methods
    //
    // -----------------
    /**
     * Add an resource
     * @param  {string} resourceId                - Useless id
     * @param  {Resource} resource      - Resource
     * @return {ng.IPromise<Resource>}  - Resource
     * @this   {SqlQuery}
     */
    function saveBackUp(resourceId, resource) {
      const _this = this;
      const indexedFields = _this.helpers.indexed_fields;
      const tableName = this.backUpName;
      // Request
      const request = prepareInsertRequest([resource], indexedFields, tableName);

      return this.execute(request.query, request.params)
        .then(() => resource)
        .catch((err) => {
          $log.error('[Backup] Save', _this.backUpName, ':', err.message);
          throw err;
        });
    }

    /**
     * Update an resource
     * @param  {Resource} resource      - Resource
     * @return {ng.IPromise<Resource>}  - Resource
     * @this   {SqlQuery}
     */
    function updateBackUp(resource) {
      const _this = this;
      const tableName = _this.backUpName;
      const indexedFields = _this.helpers.indexed_fields;
      const request = prepareUpdateRequest(resource, indexedFields, tableName);

      return this.execute(request.query, request.params)
        .then(() => resource)
        .catch((err) => {
          $log.error('[Backup] Update', tableName, ':', err.message);
          throw err;
        });
    }

    /**
     * Delete an resource by his id
     * @param  {String} resourceId          - The id of the resource to delete
     * @return {ng.IPromise<SQLResultSet>}  - Request result
     * @this   {SqlQuery}
     */
    function removeBackUp(resourceId) {
      var _this = this;
      var request = prepareDeleteRequest({ id: resourceId }, _this.backUpName);

      return this.execute(request.query, request.params)
        .catch((err) => {
          $log.error('[Backup] Remove', _this.backUpName, ':', err.message);
          throw err;
        });
    }

    /**
     * ???
     * @param  {FiltersParameters} filtersParams - The id of the resource to delete
     * @return {ng.IPromise<SQLResultSet>}    - Request result
     * @this   {SqlQuery}
     */
    function removeQueryBackUp(filtersParams) {
      var _this = this;
      var request = prepareDeleteRequest(filtersParams, _this.backUpName);

      return this.execute(request.query, request.params)
        .catch((err) => {
          $log.error('[Backup] Remove', _this.backUpName, ':', err.message);
          throw err;
        });
    }

    /**
     * Update a bunch of datas (update and delete).
     *
     * @param  {Array} _datas  - Datas to updates
     * @return {ng.IPromise<SQLResultSet[]|void>}       - Request result
     * @this   {SqlQuery}
     */
    function bulkDocsBackUp(_datas) {
      const _this = this;
      const indexedFields = _this.helpers.indexed_fields;
      const tableName = _this.backUpName;

      var queries = [];

      // Deleted
      var deleteIds = _datas
        .filter(entry => entry._deleted)
        .map(entry => entry.id);
      var upsertDatas = _datas
        .filter(entry => !entry._deleted);

      // Delete what has to be deleted
      if(deleteIds.length) {
        queries.push(prepareDeleteRequest({ id: deleteIds }, tableName));
      }
      // Upsert what has to be upserted
      if(upsertDatas.length) {
        queries.push(prepareInsertRequest(upsertDatas, indexedFields, tableName));
      }

      return (queries.length) ?
        $q.all(queries
          .map(query => _this.execute(query.query, query.params))
        )
          .catch((err) => {
            $log.error('[Backup] Bulk', _this.backUpName, ':', err.message);
            throw err;
          }) :
        $q.when();
    }

    // -----------------
    //
    //    HELPERS
    //
    // -----------------
    /**
     * @param  {String} sqlStatement        -
     * @param  {any[]}  [bindings]          -
     * @return {ng.IPromise<SQLResultSet>}  -
     * @this   {SqlQuery}
     */
    function execute(sqlStatement, bindings) {
      var q = $q.defer();

      this.backUpDB()
        .then((database) => {
          database.transaction((tx) => {
            tx.executeSql(
              sqlStatement,
              bindings,
              (transaction, resultSet) => { q.resolve(resultSet); },
              (transaction, error) => { q.reject(error); return false; }
            );
          });
        });
      return q.promise;
    }

    /**
     * Make an SQLite by request batch of datas
     *
     * @param  {QueryObject[]} queries  -
     * @return {ng.IPromise<any>}       - Request result
     * @this   {SqlQuery}
     */
    function batch(queries) {
      var q = $q.defer();

      this.backUpDB()
        .then(database => (database.sqlBatch) ?
          database.sqlBatch(// typedef does not know about it
            queries.map(query => [query.query, query.params || []]),
            res => q.resolve(res),
            err => q.reject(err)
          ) :
          batchFallback(database)
            .then(q.resolve)
            .catch(q.reject)
        );

      return q.promise;

      /**
       * @param   {Database}          database -
       * @returns {ng.IPromise<void>}          -
       */
      function batchFallback(database) {
        var qFallback = $q.defer();

        database.transaction(
          (tx) => {
            queries.forEach(function queryDb(query) {
              tx.executeSql(
                query.query,
                query.params || []
              );
            });
          },
          qFallback.reject,
          qFallback.resolve
        );

        return qFallback.promise;
      }
    }


    return SqlQuery;
  }

  // -----------------
  //
  //   QUERY HELPERS
  //
  // -----------------
  /**
   * @param   {string}          tableName     -
   * @param   {*}               queryAsObject -
   * @param   {LimitParameters} limitParams   -
   * @param   {SortParameter[]} sortParams    -
   * @returns {QueryObject}                   -
   */
  function prepareSimpleQuery(tableName, queryAsObject, limitParams, sortParams) {
    return {
      query: getSimpleQuery(queryAsObject),
      params: Object.keys(queryAsObject.self)
        .reduce((arr, column) => arr.concat(
          queryAsObject.self[column]),
        []),
    };

    /**
     * @param   {*}       queryObject -
     * @returns {string}              -
     */
    function getSimpleQuery(queryObject) {
      const statement = `SELECT * FROM ${tableName}`;
      const queries = [].concat(
        getSelfQuery(queryObject.self),
        getExtQuery(queryObject.ext)
      );
      const whereDefinition = (queries.length) ? ' WHERE ' : '';
      const andDefinition = queries.join(' AND ');
      const dataDefinition = `${whereDefinition}${andDefinition}`;
      const query = statement + dataDefinition;
      const sortedQuery = addOrderByClause(query, sortParams);
      const limitDefinition = addPaginationClauses(sortedQuery, limitParams);

      return `${limitDefinition};`;
    }


    function getSelfQuery(self) {
      return Object.keys(self)
        .map((column) => {
          const value = queryAsObject.self[column];
          const queryParams = !angular.isArray(value) ?
            '=?' :
            ` IN (${slotsString(value)})`;

          return column + queryParams;
        });
    }


    function getExtQuery(self) {
      return Object.keys(self)
        .map((column) => {
          const cTmpName = `tmp_${tableName}_${column}`;

          return `${column} IN (SELECT value FROM ${cTmpName})`;
        });
    }
  }
  /**
   * Construct the method to update database
   *
   * @param  {string}            tableName     - Name of the table
   * @param  {FiltersParameters} filtersParams - Params to query with
   * @param  {LimitParameters}   limitParams   - Limit params of the query
   * @return {QueryObject}                     - Update query + associated request params
   */
  function prepareSelect(tableName, filtersParams, limitParams = {}) {
    const statement = `SELECT * FROM ${tableName}`;
    const query = addWhereClause(statement, filtersParams);
    const queryLimit = addPaginationClauses(query, limitParams);
    const queryParamsValues = extractValues(filtersParams);

    return {
      query: queryLimit,
      params: queryParamsValues,
    };
  }

  /**
   * @param   {FiltersParameters} [filtersParams={}] -
   * @returns {string}                               - expression that can be used in a WHERE clause
   */
  function generateWhereExpression(filtersParams = {}) {
    return joinFilterClauses(
      Object.keys(filtersParams)
        .map(key => applyDefaultOperator(key, filtersParams[key]))
    );
  }

  /**
   * @param   {SortParameter[]} [sortParams=[]] -
   * @returns {string}                          - expression that can be used in an ORDER BY clause
   */
  function generateOrderByExpression(sortParams = []) {
    return sortParams.map(({ key, desc }) => `${key}${desc ? ' DESC' : ''}`).join(',');
  }

  /**
   * @param {string[]} filterClauses - 
   * @returns {string}               - filterClause
   */
  function joinFilterClauses(filterClauses) {
    return filterClauses.join(' AND ');
  }

  /**
   * @param   {FiltersParameters} filtersParameters -
   * @returns {any[]}                               - Array of values
   */
  function extractValues(filtersParameters = {}) {
    return Object.keys(filtersParameters)
      .map(key => filtersParameters[key])
      .reduce((acc, value) => acc.concat(value), []); // flatten array values 
    // extractValues({} a: 1, b: [2, 3] }) => [1, 2, 3]
  }

  /**
   * @param   {string} filterKey  -
   * @param   {any} filterValue   -
   * @returns {string}            - Filter clause that can be used in a where clause
   */
  function applyDefaultOperator(filterKey, filterValue) {
    return Array.isArray(filterValue) ?
      `${filterKey} IN (${slotsString(filterValue)})` :
      `${filterKey}=?`;
  }

  /**
   * @param   {string}            sqlQuery        -
   * @param   {FiltersParameters} [filtersParams] -
   * @returns {string}                            - SQL Query
   */
  function addWhereClause(sqlQuery, filtersParams = {}) {
    const hasFilters = 0 < Object.keys(filtersParams).length;

    return hasFilters ?
      `${sqlQuery} WHERE ${generateWhereExpression(filtersParams)}` :
      sqlQuery;
  }

  /**
   * @param   {string}            sqlQuery    -
   * @param   {SortParameter[]}  [sortParams] -
   * @returns {string}                        - SQL Query
   */
  function addOrderByClause(sqlQuery, sortParams = []) {
    const hasSort = 0 < sortParams.length;

    return hasSort ?
      `${sqlQuery} ORDER BY ${generateOrderByExpression(sortParams)}` :
      sqlQuery;
  }

  /**
   * @param   {string}           sqlQuery         -
   * @param   {LimitParameters}  [limitParams={}] -
   * @returns {string}                            - SQL Query
   */
  function addPaginationClauses(sqlQuery, limitParams = {}) {
    let ammendedQuery = sqlQuery;

    if(limitParams.limit) {
      ammendedQuery += ` LIMIT ${limitParams.limit}`;
    }
    if(limitParams.offset) {
      ammendedQuery += ` OFFSET ${limitParams.offset}`;
    }
    return ammendedQuery;
  }

  /**
   * Construct the method to update database
   *
   * @param  {Resource[]}  entries       -
   * @param  {string[]}    indexedFields -
   * @param  {string}      tableName     -
   * @return {QueryObject}               -
   */
  function prepareInsertRequest(entries, indexedFields, tableName) {
    const statement = `INSERT OR REPLACE INTO ${tableName}`;
    const allFields = ['id', 'payload'].concat(indexedFields);
    const fieldsRequest = `(${allFields.join(', ')})`;
    const params = (1 < entries.length) ?
      prepareInsertUnionQuery(entries, allFields) :
      `VALUES (${slotsString(allFields)})`;

    return {
      query: `${statement} ${fieldsRequest} ${params}`,
      params: entries
        .map(entry => [entry.id].concat(prepareRequestValues(entry, indexedFields)))
        .reduce((arr, upsert) => arr.concat(upsert), []),
    };
  }

  function prepareInsertUnionQuery(datas, fields) {
    const arrFields = [].concat(fields);
    const selectAs = prepareSelectAs(arrFields);

    return datas
      .map((data, index) => ((0 === index) ?
        selectAs :
        `UNION ALL SELECT ${slotsString(arrFields)}`))
      .join(' ');
  }

  function prepareSelectAs(fields) {
    const allFields = fields
      .map(field => `? as ${field}`)
      .join(', ');

    return `SELECT ${allFields}`;
  }

  /**
   * Prepare the query and the params associated to update the datas
   *
   * @param  {Resource} resource      - resource to update
   * @param  {string[]} indexedFields - Indexed fields of the table
   * @param  {String}   tableName     - Name to the table to update
   * @return {Object}                 - Update query + associated request params
   */
  function prepareUpdateRequest(resource, indexedFields, tableName) {
    const statement = `UPDATE ${tableName}`;
    const fields = ['payload'].concat(indexedFields);
    // Datas
    const requestValues = prepareRequestValues(resource, indexedFields);
    // Request
    const dataDefinition = fields
      .map(field => `${field}=?`)
      .join(', ');

    return {
      query: `${statement} SET ${dataDefinition} WHERE id=?`,
      params: requestValues.concat([resource.id]),
    };
  }

  /**
   * Prepare the query and the params associated to delete datas
   *
   * @param  {FiltersParameters} filtersParameters  - params of data to delete
   * @param  {String}            tableName          - Name of the table
   * @return {QueryObject}                          -
   */
  function prepareDeleteRequest(filtersParameters, tableName) {
    const statement = `DELETE FROM ${tableName}`;
    const query = addWhereClause(statement, filtersParameters);

    return {
      query: query,
      params: extractValues(filtersParameters),
    };
  }

  /**
   * Get an array of the values to call with the query
   *
   * @param  {Resource} resource  - Resource
   * @param  {string[]} fields    - Fields name to get values for
   * @return {Array}              - Datas to past to the request
   */
  function prepareRequestValues(resource, fields) {
    var entryDataFields = getFieldsData(resource, fields);

    return [angular.toJson(resource)]
      .concat(entryDataFields);
  }

  /**
   * @param   {Resource} resource                 -
   * @param   {string[]} fields                   -
   * @returns {Exclude<any, undefined|boolean>[]} -
   */
  function getFieldsData(resource, fields) {
    return fields
      .map((field) => {
        const nonBooleanValue = boolToInteger(resource[field]);

        return (angular.isDefined(nonBooleanValue)) ? nonBooleanValue : null;
      });
  }

  /**
   * @param  {Resource[]}        resources          -
   * @param  {FiltersParameters} [filtersParams={}] -
   * @return {Resource[]}                           -
   */
  function inMemoryFilter(resources, filtersParams = {}) {
    if(!Object.keys(filtersParams).length) {
      return resources;
    }

    return resources
      .filter(resource =>
        Object.keys(filtersParams).every((filterKey) => {
          var resourceValue = resource[filterKey];
          var filterValue = filtersParams[filterKey];

          return angular.isArray(filterValue) ?
            filterValue.some(value => value === resourceValue) : // In for array
            (filterValue === resourceValue); // Equal for single value
        })
      );
  }

  /**
   * Get all results from the database response
   *
   * @param  {SQLResultSet} sqlResultSet  -
   * @return {Object[]}                   - Array of unserialized payload column values
   */
  function transformResults(sqlResultSet) {
    var datas = [];
    var i = 0;

    for(i = 0; i < sqlResultSet.rows.length; i++) {
      datas[i] = unserializePayloadColumn(sqlResultSet, i);
    }
    return datas;
  }

  /**
   * @param   {FiltersParameters} filtersParams -
   * @returns {SanitizedFiltersParameters}               - 
   */
  function sanitizeFiltersValues(filtersParams) {
    return Object.keys(filtersParams)
      .reduce((filtersHash, filterKey) => {
        filtersHash[filterKey] = boolToInteger(filtersParams[filterKey]);
        return filtersHash;
      }, {});
  }

  /**
   * @param   {string[]}          indexedColumns  -
   * @param   {FiltersParameters} filtersParams   -
   * @returns {FiltersParameters}                 -
   */
  function pickNonIndexed(indexedColumns, filtersParams) {
    const isIndexed = filterKey => -1 !== indexedColumns.indexOf(filterKey) ||
      'id' === filterKey;

    return Object.keys(filtersParams)
      .reduce((indexedQueries, filterKey) => {
        if(!isIndexed(filterKey)) {
          indexedQueries[filterKey] = filtersParams[filterKey];
        }
        return indexedQueries;
      }, {});
  }

  /**
   * @param   {string[]}          indexedColumns  -
   * @param   {FiltersParameters} filtersParams   -
   * @returns {FiltersParameters}                 -
   */
  function pickIndexed(indexedColumns, filtersParams) {
    /**
     * @param {string} filterKey -
     * @returns {boolean}        -
     * */
    const isIndexed = filterKey => -1 !== indexedColumns.indexOf(filterKey) ||
      'id' === filterKey;

    return Object.keys(filtersParams)
      .reduce((indexedQueries, filterKey) => {
        if(isIndexed(filterKey)) {
          indexedQueries[filterKey] = filtersParams[filterKey];
        }
        return indexedQueries;
      }, {});
  }

  /**
   * @param {SQLResultSet} sqlResultSet -
   * @param {number} index -
   * @returns {any} - Unserialised payload column value
   */
  function unserializePayloadColumn(sqlResultSet, index) {
    return angular.fromJson(sqlResultSet.rows.item(index).payload);
  }

  /**
   * @param   {any[]}  array -
   * @returns {string}       -
   */
  function slotsString(array) {
    return array.map(() => '?').join(',');
  }

  /**
   * @param   {any}                   value -
   * @returns {Exclude<any, boolean>}       -
   */
  function boolToInteger(value) {
    return (isBoolean(value)) ?
      ((value) ? 1 : 0) :
      value;
  }

  /**
   * @param   {any}     value -
   * @returns {boolean}       -
   */
  function isBoolean(value) {
    return 'boolean' === typeof value;
  }

  /**
   * @param   {any[]}         array -
   * @param   {number}        size  -
   * @returns {Array<any[]>}        -
   */
  function chunck(array, size) {
    const len = array.length;
    const nbOfSlices = Math.ceil(len / size);
    let sliced = [];
    let i = 0;
    let start = 0;
    let end = 0;

    for(; i < nbOfSlices; i++) {
      start = i * size;
      end = (i + 1) * (size);
      sliced.push(array.slice(start, end));
    }

    return sliced;
  }

}(window.angular));
