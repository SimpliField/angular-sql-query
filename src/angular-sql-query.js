(function iife() {
  'use strict';

  const PARAMS_LIMIT = 100;
  const NB_PARAMS_MAX = 300;

  angular
    .module('sf.sqlQuery', [])
    .factory('SqlQueryService', SqlQueryService);

  // @ngInject
  function SqlQueryService($log, $q) {

    function SqlQuery(name, databaseFn, options = {}) {
      const indexedFields = options.indexed_fields || [];

      this.options = options;
      this.backUpName = name;
      this.helpers = { indexed_fields: indexedFields };

      this.backUpDB = backUpDB;

      return this;

      function backUpDB() {
        return databaseFn();
      }
    }

    // Methods
    SqlQuery.prototype.getBackUp = getBackUp;
    SqlQuery.prototype.listBackUp = listBackUp;
    SqlQuery.prototype.queryBackUp = queryBackUp;
    SqlQuery.prototype.saveBackUp = saveBackUp;
    SqlQuery.prototype.updateBackUp = updateBackUp;
    SqlQuery.prototype.removeBackUp = removeBackUp;
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
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function listBackUp() {
      var _this = this;
      var request = prepareSelect(_this.backUpName);

      return this.execute(request.query)
        .then(transformResults)
        .catch((err) => {
          $log.error('[Backup] List', _this.backUpName, ':', err.message);
          throw err;
        });
    }

    /**
     * Request a specific entry by his id
     *
     * @param  {Object} entryId - Id of the entry to request
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function getBackUp(entryId) {
      var _this = this;
      var request = prepareSelect(_this.backUpName, {
        id: entryId,
      });

      return this.execute(request.query, request.params)
        .then(doc => (doc.rows.length) ?
          getRowPayload(doc, 0) :
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
     * @param  {Object} params - Request Params
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function queryBackUp(params) {
      const _this = this;
      const indexedFields = _this.helpers.indexed_fields;
      const castedParams = castParamsForQuery(params || {});
      const indexedParams = getIndexedParams(indexedFields, castedParams);
      const organizedIndexedParams = organiseIndexedParamsForQuery(indexedParams);
      const tmpQueries = buildInsertTmpTablesQueries(
        _this.backUpName,
        organizedIndexedParams
      );
      const tmpTablesQueries = tmpQueries
        .reduce((arr, queries) => arr.concat(queries), []);
      const batchPromise = (tmpTablesQueries.length) ?
        _this.batch(tmpTablesQueries) :
        $q.when();

      return batchPromise
        .then(function onceCreated() {
          var query = prepareSimpleQuery(_this.backUpName, organizedIndexedParams);

          return _this.execute(query.query, query.params)
            .then((docs) => {
              const datas = transformResults(docs);
              const nonIndexedParams = getNonIndexedParams(indexedFields, castedParams);

              // Non indexedFields filtering
              return filterDatas(datas, nonIndexedParams);
            });
        })
        .catch((err) => {
          $log.error('[Backup] Query', _this.backUpName, ':', err.message);
          throw err;
        });

      function organiseIndexedParamsForQuery(_indexedParams) {
        return Object.keys(_indexedParams)
          .reduce((accu, columnName) => {
            const value = _indexedParams[columnName];
            const valueIsAnArray = angular.isArray(value);

            if(valueIsAnArray && PARAMS_LIMIT < value.length) {
              accu.ext[columnName] = value;
            } else {
              accu.self[columnName] = value;
            }

            return accu;
          }, {
            self: {},
            ext: {},
          });
      }

      function buildInsertTmpTablesQueries(name, _params) {
        var tmpName = `tmp_${name}_`;

        return Object.keys(_params.ext || {})
          .map((key) => {
            const cTmpName = tmpName + key;
            const dropTableQuery = `DROP TABLE IF EXISTS ${cTmpName}`;
            const createTableQuery = `CREATE TABLE IF NOT EXISTS ${cTmpName} (value TEXT)`;
            const insertQuery = buildInsertQueryWith(cTmpName, 'value', _params.ext[key]);

            return [
              { query: dropTableQuery },
              { query: createTableQuery },
            ].concat(insertQuery);
          });
      }

      function buildInsertQueryWith(table, column, data) {
        var nbBySlice = NB_PARAMS_MAX;
        var sliced = splitInSlice(data, nbBySlice);

        return sliced
          .map((slice) => {
            const query = `INSERT INTO ${table}`;
            const sliceQuery = prepareInsertUnionQuery(slice, column);

            return {
              query: `${query} ${sliceQuery}`,
              params: slice,
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
     * Add an entry
     *
     * @param  {Object} entryId - Id of the entry to add
     * @param  {Object} entry   - Datas of the entry to add
     * @return {Promise}        - Request result
     * @this SqlQueryService
     */
    function saveBackUp(entryId, entry) {
      const _this = this;
      const indexedFields = _this.helpers.indexed_fields;
      const tableName = this.backUpName;
      // Request
      const request = prepareInsertRequest([entry], indexedFields, tableName);

      return this.execute(request.query, request.params)
        .then(() => entry)
        .catch((err) => {
          $log.error('[Backup] Save', _this.backUpName, ':', err.message);
          throw err;
        });
    }

    /**
     * Update an entry
     *
     * @param  {Object} entry   - Datas of the entry to update
     * @return {Promise}        - Request result
     * @this SqlQueryService
     */
    function updateBackUp(entry) {
      const _this = this;
      const tableName = _this.backUpName;
      const indexedFields = _this.helpers.indexed_fields;
      const request = prepareUpdateRequest(entry, indexedFields, tableName);

      return this.execute(request.query, request.params)
        .then(() => entry)
        .catch((err) => {
          $log.error('[Backup] Update', tableName, ':', err.message);
          throw err;
        });
    }

    /**
     * Delete an entry by his id
     *
     * @param  {String} dataId  - The id of the entry to delete
     * @return {Promise}        - Request result
     * @this SqlQueryService
     */
    function removeBackUp(dataId) {
      var _this = this;
      var request = prepareDeleteRequest([dataId], _this.backUpName);

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
     * @return {Promise}       - Request result
     * @this SqlQueryService
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
        queries.push(prepareDeleteRequest(deleteIds, tableName));
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
     * Make an SQLite request with the param query and params
     *
     * @param  {String} query  - SQL Query
     * @param  {[Array]} datas - Datas for querying
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function execute(query, datas) {
      var q = $q.defer();

      this.backUpDB()
        .then((database) => {
          database.transaction((tx) => {
            tx.executeSql(query, datas, (sqlTx, result) => {
              q.resolve(result);
            }, (transaction, error) => {
              q.reject(error);
            });
          });
        });

      return q.promise;
    }

    /**
     * Make an SQLite by request batch of datas
     *
     * @param  {Array} queries - An array containing the request and the params
     *                           of the batches
     *  {String} []queries.query - Query to execute
     *  {Array} []queries.params - Query params
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function batch(queries) {
      var q = $q.defer();

      this.backUpDB()
        .then(database => (database.sqlBatch) ?
          database.sqlBatch(
            queries.map(query => [query.query, query.params || []]),
              res => q.resolve(res),
              err => q.reject(err)
            ) :
          batchFallback(database)
            .then(q.resolve)
            .catch(q.reject)
        );

      return q.promise;

      function batchFallback(database) {
        var qFallback = $q.defer();

        database.transaction((tx) => {
          queries.forEach(function queryDb(query) {
            $log.info('SQLite Bulk', query.query, query.params);
            tx.executeSql(
              query.query,
              query.params || []
            );
          });
        },
        qFallback.reject,
        qFallback.resolve);

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
  function prepareSimpleQuery(tableName, queryAsObject) {
    return {
      query: getSimpleQuery(queryAsObject),
      params: Object.keys(queryAsObject.self)
        .reduce((arr, column) => arr.concat(
          queryAsObject.self[column]),
          []
        ),
    };

    function getSimpleQuery(queryObject) {
      const statement = `SELECT * FROM ${tableName}`;
      const queries = [].concat(
        getSelfQuery(queryObject.self),
        getExtQuery(queryObject.ext)
      );
      const whereDefinition = (queries.length) ? ' WHERE ' : '';
      const andDefinition = queries.join(' AND ');
      const dataDefinition = `${whereDefinition}${andDefinition};`;

      return statement + dataDefinition;
    }
    function getSelfQuery(self) {
      return Object.keys(self)
        .map((column) => {
          const value = queryAsObject.self[column];
          const queryParams = !angular.isArray(value) ?
            '=?' :
            ` IN (${getMarks(value)})`;

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
   * @param  {String} tableName - Name of the table
   * @param  {Object}  params   - Params to query with
   * @return {String}           - Update query + associated request params
   */
  function prepareSelect(tableName, params = {}) {
    const statement = `SELECT * FROM ${tableName}`;
    const queryParamsKeys = Object.keys(params);
    const dataDefinition = queryParamsKeys
      .map(paramKey => `${paramKey}=?`)
      .join(' AND ');
    const queryParamsValues = queryParamsKeys
      .map(paramKey => params[paramKey]);

    return {
      query: (dataDefinition) ?
        `${statement} WHERE ${dataDefinition}` :
        statement,
      params: queryParamsValues,
    };
  }
  /**
   * Construct the method to update database
   *
   * @param  {Array}  entries       - Entries to add in database
   * @param  {Array}  indexedFields - Fields name to get values for
   * @param  {String} tableName     - Name of the table
   * @return {String}            - Update query + associated request params
   */
  function prepareInsertRequest(entries, indexedFields, tableName) {
    const statement = `INSERT OR REPLACE INTO ${tableName}`;
    const allFields = ['id', 'payload'].concat(indexedFields);
    const questionsMark = getMarks(allFields);
    const fieldsRequest = `(${allFields.join(', ')})`;
    const params = (1 < entries.length) ?
      prepareInsertUnionQuery(entries, allFields) :
      `VALUES (${questionsMark})`;

    return {
      query: `${statement} ${fieldsRequest} ${params}`,
      params: entries
        .map(entry => [entry.id].concat(prepareRequestValues(entry, indexedFields)))
        .reduce((arr, upsert) => arr.concat(upsert), []),
    };
  }
  function prepareInsertUnionQuery(datas, fields) {
    const arrFields = [].concat(fields);
    const questionsMark = getMarks(arrFields);
    const selectAs = prepareSelectAs(arrFields);

    return datas
      .map((data, index) => ((0 === index) ?
        selectAs :
        `UNION ALL SELECT ${questionsMark}`))
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
   * @param  {Array}  entry         - Entry to update
   * @param  {String} indexedFields - Indexed fields of the table
   * @param  {String} tableName     - Name to the table to update
   * @return {Object}             - Update query + associated request params
   */
  function prepareUpdateRequest(entry, indexedFields, tableName) {
    const statement = `UPDATE ${tableName}`;
    const fields = ['payload'].concat(indexedFields);
    // Datas
    const requestValues = prepareRequestValues(entry, indexedFields);
    // Request
    const dataDefinition = fields
      .map(field => `${field}=?`)
      .join(', ');

    return {
      query: `${statement} SET ${dataDefinition} WHERE id=?`,
      params: requestValues.concat([entry.id]),
    };
  }
  /**
   * Prepare the query and the params associated to delete datas
   *
   * @param  {Array}  ids       - ids of data to delete
   * @param  {String} tableName - Name of the table
   * @return {[String]}       - Delete query + associated request params
   */
  function prepareDeleteRequest(ids, tableName) {
    const statement = `DELETE FROM ${tableName} WHERE id`;
    const questionsMark = getMarks(ids);
    const query = (1 < ids.length) ?
      ` IN (${questionsMark})` :
      '=?';

    return {
      query: `${statement}${query}`,
      params: ids,
    };
  }
  /**
   * Get an array of the values to call with the query
   *
   * @param  {Object} entry - Object data
   * @param  {Array} fields - Fields name to get values for
   * @return {Array}        - Datas to past to the request
   */
  function prepareRequestValues(entry, fields) {
    var entryDataFields = getFieldsData(entry, fields);

    return [angular.toJson(entry)]
      .concat(entryDataFields);
  }
  function getFieldsData(entry, fields) {
    return fields
      .map((field) => {
        const value = entry[field];
        let castValue = castBooleanValue(value);

        return (angular.isDefined(castValue)) ? castValue : null;
      });
  }

  /**
   * Filter datas with params query
   *
   * It's possible to set an String/Number/Boolean or an Array
   * to the value of a param.
   *
   * @param  {Array} datas    - Datas to be filtered
   * @param  {Object} params  - Key/value of datas to be filtered
   * @return {Array}          - Datas filtered
   */
  function filterDatas(datas, params) {
    if(!Object.keys(params).length) {
      return datas;
    }

    return datas
      .filter(data => Object.keys(params || {})
        .every((key) => {
          var currentData = data[key];
          var paramValue = params[key];

          return (angular.isArray(paramValue)) ?
            paramValue
              .some(value => value === currentData) :
            (paramValue === currentData);
        })
      );
  }

  /**
   * Get all results from the database response
   *
   * @param  {Object} docs - SQL docs type
   * @return {Array}       - List of datas
   */
  function transformResults(docs) {
    var datas = [];
    var i = 0;

    for(i = 0; i < docs.rows.length; i++) {
      datas[i] = getRowPayload(docs, i);
    }
    return datas;
  }

  function castParamsForQuery(queryAsObject) {
    return Object.keys(queryAsObject)
      .reduce(function cast(castedQuery, queryKey) {
        const queryValue = queryAsObject[queryKey];
        const castValue = castBooleanValue(queryValue);

        castedQuery[queryKey] = castValue;

        return castedQuery;
      }, {});
  }

  function getNonIndexedParams(arrOfIndexes, queryAsObject) {
    return Object.keys(queryAsObject)
      .reduce(function extractNonIndexedQueries(nonIndexedQueries, queryKey) {
        if(!isAnIndexedParam(queryKey, arrOfIndexes)) {
          nonIndexedQueries[queryKey] = queryAsObject[queryKey];
        }
        return nonIndexedQueries;
      }, {});
  }

  function getIndexedParams(arrOfIndexes, queryAsObject) {
    return Object.keys(queryAsObject)
      .reduce(function extractIndexedQueries(indexedQueries, queryKey) {
        if(isAnIndexedParam(queryKey, arrOfIndexes)) {
          indexedQueries[queryKey] = queryAsObject[queryKey];
        }
        return indexedQueries;
      }, {});
  }
  function isAnIndexedParam(queryKey, arrOfIndexes) {
    return -1 !== arrOfIndexes.indexOf(queryKey) || 'id' === queryKey;
  }

  function getRowPayload(doc, nbItem) {
    return angular.fromJson(doc.rows.item(nbItem).payload);
  }
  function getMarks(datas) {
    return datas
      .map(() => '?')
      .join(',');
  }
  function castBooleanValue(value) {
    return (isBoolean(value)) ?
      ((value) ? 1 : 0) :
      value;
  }
  function isBoolean(value) {
    return 'boolean' === typeof value;
  }

  function splitInSlice(data, nbBySlice) {
    const len = data.length;
    const nbOfSlices = Math.ceil(len / nbBySlice);
    let sliced = [];
    let i = 0;
    let start = 0;
    let end = 0;

    for(; i < nbOfSlices; i++) {
      start = i * nbBySlice;
      end = (i + 1) * (nbBySlice);
      sliced.push(data.slice(start, end));
    }

    return sliced;
  }

}());
