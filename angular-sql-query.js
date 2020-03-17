'use strict';

// @ts-check

(function iife(angular) {
  'use strict';

  SqlQueryService.$inject = ["$log", "$q"];
  var PARAMS_LIMIT = 100;
  var NB_PARAMS_MAX = 300;

  angular.module('sf.sqlQuery', []).factory('SqlQueryService', SqlQueryService);

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
    function SqlQuery(tableName, databaseFn) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      var indexedFields = options.indexed_fields || [];

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
      var _this = this;
      var request = prepareSelect(_this.backUpName, {}, limitParams);

      return this.execute(request.query).then(transformResults).catch(function (err) {
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
      if (!entryId) {
        throw new Error('You need to provide an id');
      }

      var _this = this;
      var request = prepareSelect(_this.backUpName, { id: entryId });

      return this.execute(request.query, request.params).then(function (doc) {
        return doc.rows.length ? unserializePayloadColumn(doc, 0) : $q.reject({ message: 'Not Found', status: 404 });
      }).catch(function (err) {
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
    function queryBackUp() {
      var filtersParams = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
      var limitParams = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      var sortParams = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];

      var _this = this;
      var indexedFields = _this.helpers.indexed_fields;

      // filtersParams 
      // |> sanitizeFiltersValues - remove boolean values
      // |> pickIndexed           - keep only indexed cols related filters
      // |> partitionByQuerySize  - split high sized filtervalues
      var sanitizedFiltersParams = sanitizeFiltersValues(filtersParams);
      var indexedFiltersParams = pickIndexed(indexedFields, sanitizedFiltersParams);
      var partitionnedFiltersParams = partitionByQuerySize(indexedFiltersParams);
      var tmpQueries = buildInsertTmpTablesQueries(_this.backUpName, partitionnedFiltersParams);
      var tmpTablesQueries = tmpQueries.reduce(function (arr, queries) {
        return arr.concat(queries);
      }, []);

      // building the temp tables if needed
      var batchPromise = tmpTablesQueries.length ? _this.batch(tmpTablesQueries) : $q.when();

      return batchPromise.then(function () {
        var query = prepareSimpleQuery(_this.backUpName, partitionnedFiltersParams, limitParams, sortParams);

        return _this.execute(query.query, query.params).then(function (docs) {
          var datas = transformResults(docs);
          var nonIndexedParams = pickNonIndexed(indexedFields, sanitizedFiltersParams);

          return inMemoryFilter(datas, nonIndexedParams);
        });
      }).catch(function (err) {
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
        var valueSizeTooBig = function valueSizeTooBig(value) {
          return angular.isArray(value) && PARAMS_LIMIT < value.length;
        };

        return Object.keys(filterParams).reduce(function (partition, columnName) {
          var value = filterParams[columnName];

          partition[valueSizeTooBig(value) ? 'ext' : 'self'][columnName] = value;
          return partition;
        }, { self: {}, ext: {} });
      }

      /**
       * @param   {string}         tableName              -
       * @param   {QueryPartition} filtersParamsPartition -
       * @returns {QuerySequence[]}                       -
       */
      function buildInsertTmpTablesQueries(tableName, filtersParamsPartition) {
        return Object.keys(filtersParamsPartition.ext).map(function (key) {
          var cTmpName = 'tmp_' + tableName + '_' + key;
          var dropTableQuery = 'DROP TABLE IF EXISTS ' + cTmpName;
          var createTableQuery = 'CREATE TABLE IF NOT EXISTS ' + cTmpName + ' (value TEXT)';
          var insertQueries = buildInsertQueries(cTmpName, 'value', filtersParamsPartition.ext[key]);

          return [{ query: dropTableQuery }, { query: createTableQuery }].concat(insertQueries);
        });
      }

      /**
       * @param   {string} tableName    -
       * @param   {string} column       -
       * @param   {any[]}  filterValues - 
       * @returns {QuerySequence}       -
       */
      function buildInsertQueries(tableName, column, filterValues) {
        return chunck(filterValues, NB_PARAMS_MAX).map(function (fvChunck) {
          var query = 'INSERT INTO ' + tableName;
          var sliceQuery = prepareInsertUnionQuery(fvChunck, column);

          return {
            query: query + ' ' + sliceQuery,
            params: fvChunck
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
      var _this = this;
      var indexedFields = _this.helpers.indexed_fields;
      var tableName = this.backUpName;
      // Request
      var request = prepareInsertRequest([resource], indexedFields, tableName);

      return this.execute(request.query, request.params).then(function () {
        return resource;
      }).catch(function (err) {
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
      var _this = this;
      var tableName = _this.backUpName;
      var indexedFields = _this.helpers.indexed_fields;
      var request = prepareUpdateRequest(resource, indexedFields, tableName);

      return this.execute(request.query, request.params).then(function () {
        return resource;
      }).catch(function (err) {
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

      return this.execute(request.query, request.params).catch(function (err) {
        $log.error('[Backup] Remove', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    /**
     * @param  {FiltersParameters}          filtersParams -
     * @return {ng.IPromise<SQLResultSet>}                - Request result
     * @this   {SqlQuery}
     */
    function removeQueryBackUp(filtersParams) {
      var _this = this;
      var request = prepareDeleteRequest(filtersParams, _this.backUpName);

      return this.execute(request.query, request.params).catch(function (err) {
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
      var _this = this;
      var indexedFields = _this.helpers.indexed_fields;
      var tableName = _this.backUpName;

      var queries = [];

      // Deleted
      var deleteIds = _datas.filter(function (entry) {
        return entry._deleted;
      }).map(function (entry) {
        return entry.id;
      });
      var upsertDatas = _datas.filter(function (entry) {
        return !entry._deleted;
      });

      // Delete what has to be deleted
      if (deleteIds.length) {
        queries.push(prepareDeleteRequest({ id: deleteIds }, tableName));
      }
      // Upsert what has to be upserted
      if (upsertDatas.length) {
        queries.push(prepareInsertRequest(upsertDatas, indexedFields, tableName));
      }

      return queries.length ? $q.all(queries.map(function (query) {
        return _this.execute(query.query, query.params);
      })).catch(function (err) {
        $log.error('[Backup] Bulk', _this.backUpName, ':', err.message);
        throw err;
      }) : $q.when();
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

      this.backUpDB().then(function (database) {
        database.transaction(function (tx) {
          tx.executeSql(sqlStatement, bindings, function (transaction, resultSet) {
            q.resolve(resultSet);
          }, function (transaction, error) {
            q.reject(error);return false;
          });
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

      this.backUpDB().then(function (database) {
        return database.sqlBatch ? database.sqlBatch( // typedef does not know about it
        queries.map(function (query) {
          return [query.query, query.params || []];
        }), function (res) {
          return q.resolve(res);
        }, function (err) {
          return q.reject(err);
        }) : batchFallback(database).then(q.resolve).catch(q.reject);
      });

      return q.promise;

      /**
       * @param   {Database}          database -
       * @returns {ng.IPromise<void>}          -
       */
      function batchFallback(database) {
        var qFallback = $q.defer();

        database.transaction(function (tx) {
          queries.forEach(function queryDb(query) {
            tx.executeSql(query.query, query.params || []);
          });
        }, qFallback.reject, qFallback.resolve);

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
      params: Object.keys(queryAsObject.self).reduce(function (arr, column) {
        return arr.concat(filterValuesToSQLBindingsValues(queryAsObject.self[column]));
      }, [])
    };

    /**
     * @param   {*}       queryObject -
     * @returns {string}              -
     */
    function getSimpleQuery(queryObject) {
      var statement = 'SELECT * FROM ' + tableName;
      var queries = [].concat(getSelfQuery(queryObject.self), getExtQuery(queryObject.ext));
      var whereDefinition = queries.length ? ' WHERE ' : '';
      var andDefinition = queries.join(' AND ');
      var dataDefinition = '' + whereDefinition + andDefinition;
      var query = statement + dataDefinition;
      var sortedQuery = addOrderByClause(query, sortParams);
      var limitDefinition = addPaginationClauses(sortedQuery, limitParams);

      return limitDefinition + ';';
    }

    /**
     * @param   {FiltersParameters} filtersParams -
     * @returns {string[]}                       - queries
     */
    function getSelfQuery(filtersParams) {
      return Object.keys(filtersParams).map(function (key) {
        return applyDefaultOperator(key, filtersParams[key]);
      });
    }

    function getExtQuery(self) {
      return Object.keys(self).map(function (column) {
        var cTmpName = 'tmp_' + tableName + '_' + column;

        return column + ' IN (SELECT value FROM ' + cTmpName + ')';
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
  function prepareSelect(tableName, filtersParams) {
    var limitParams = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

    var statement = 'SELECT * FROM ' + tableName;
    var query = addWhereClause(statement, filtersParams);
    var queryLimit = addPaginationClauses(query, limitParams);
    var queryParamsValues = extractValues(filtersParams);

    return {
      query: queryLimit,
      params: queryParamsValues
    };
  }

  /**
   * @param   {FiltersParameters} [filtersParams={}] -
   * @returns {string}                               - expression that can be used in a WHERE clause
   */
  function generateWhereExpression() {
    var filtersParams = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    return joinFilterClauses(Object.keys(filtersParams).map(function (key) {
      return applyDefaultOperator(key, filtersParams[key]);
    }));
  }

  /**
   * @param   {SortParameter[]} [sortParams=[]] -
   * @returns {string}                          - expression that can be used in an ORDER BY clause
   */
  function generateOrderByExpression() {
    var sortParams = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];

    return sortParams.map(function (_ref) {
      var key = _ref.key,
          desc = _ref.desc;
      return '' + key + (desc ? ' DESC' : '');
    }).join(',');
  }

  /**
   * @param {string[]} filterClauses - 
   * @returns {string}               - filterClause
   */
  function joinFilterClauses(filterClauses) {
    return filterClauses.join(' AND ');
  }

  /**
   * @example
   * // usage
   * extractValues({} a: 1, b: [2, 3], c: /toto/ })
   * // will return
   * [1, 2, 3, '%toto%']
   * @param   {FiltersParameters} filtersParameters -
   * @returns {any[]}                               - Array of values
   */
  function extractValues() {
    var filtersParameters = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    return Object.keys(filtersParameters).map(function (key) {
      return filterValuesToSQLBindingsValues(filtersParameters[key]);
    }).reduce(function (acc, value) {
      return acc.concat(value);
    }, []); // flatten array values 
  }

  /**
   * @param   {string} filterKey  -
   * @param   {any} filterValue   -
   * @returns {string}            - Filter clause that can be used in a where clause
   */
  function applyDefaultOperator(filterKey, filterValue) {
    return Array.isArray(filterValue) ? filterKey + ' IN (' + slotsString(filterValue) + ')' : isRegExp(filterValue) ? filterKey + ' LIKE ?' : filterKey + '=?';
  }

  /**
   * @param   {string}            sqlQuery        -
   * @param   {FiltersParameters} [filtersParams] -
   * @returns {string}                            - SQL Query
   */
  function addWhereClause(sqlQuery) {
    var filtersParams = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    var hasFilters = 0 < Object.keys(filtersParams).length;

    return hasFilters ? sqlQuery + ' WHERE ' + generateWhereExpression(filtersParams) : sqlQuery;
  }

  /**
   * @param   {string}            sqlQuery    -
   * @param   {SortParameter[]}  [sortParams] -
   * @returns {string}                        - SQL Query
   */
  function addOrderByClause(sqlQuery) {
    var sortParams = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

    var hasSort = 0 < sortParams.length;

    return hasSort ? sqlQuery + ' ORDER BY ' + generateOrderByExpression(sortParams) : sqlQuery;
  }

  /**
   * @param   {string}           sqlQuery         -
   * @param   {LimitParameters}  [limitParams={}] -
   * @returns {string}                            - SQL Query
   */
  function addPaginationClauses(sqlQuery) {
    var limitParams = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    var ammendedQuery = sqlQuery;

    if (limitParams.limit) {
      ammendedQuery += ' LIMIT ' + limitParams.limit;
    }
    if (limitParams.offset) {
      ammendedQuery += ' OFFSET ' + limitParams.offset;
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
    var statement = 'INSERT OR REPLACE INTO ' + tableName;
    var allFields = ['id', 'payload'].concat(indexedFields);
    var fieldsRequest = '(' + allFields.join(', ') + ')';
    var params = 1 < entries.length ? prepareInsertUnionQuery(entries, allFields) : 'VALUES (' + slotsString(allFields) + ')';

    return {
      query: statement + ' ' + fieldsRequest + ' ' + params,
      params: entries.map(function (entry) {
        return [entry.id].concat(prepareRequestValues(entry, indexedFields));
      }).reduce(function (arr, upsert) {
        return arr.concat(upsert);
      }, [])
    };
  }

  function prepareInsertUnionQuery(datas, fields) {
    var arrFields = [].concat(fields);
    var selectAs = prepareSelectAs(arrFields);

    return datas.map(function (data, index) {
      return 0 === index ? selectAs : 'UNION ALL SELECT ' + slotsString(arrFields);
    }).join(' ');
  }

  function prepareSelectAs(fields) {
    var allFields = fields.map(function (field) {
      return '? as ' + field;
    }).join(', ');

    return 'SELECT ' + allFields;
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
    var statement = 'UPDATE ' + tableName;
    var fields = ['payload'].concat(indexedFields);
    // Datas
    var requestValues = prepareRequestValues(resource, indexedFields);
    // Request
    var dataDefinition = fields.map(function (field) {
      return field + '=?';
    }).join(', ');

    return {
      query: statement + ' SET ' + dataDefinition + ' WHERE id=?',
      params: requestValues.concat([resource.id])
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
    var statement = 'DELETE FROM ' + tableName;
    var query = addWhereClause(statement, filtersParameters);

    return {
      query: query,
      params: extractValues(filtersParameters)
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

    return [angular.toJson(resource)].concat(entryDataFields);
  }

  /**
   * @param   {Resource} resource                 -
   * @param   {string[]} fields                   -
   * @returns {Exclude<any, undefined|boolean>[]} -
   */
  function getFieldsData(resource, fields) {
    return fields.map(function (field) {
      var nonBooleanValue = boolToInteger(resource[field]);

      return angular.isDefined(nonBooleanValue) ? nonBooleanValue : null;
    });
  }

  /**
   * @param  {Resource[]}        resources          -
   * @param  {FiltersParameters} [filtersParams={}] -
   * @return {Resource[]}                           -
   */
  function inMemoryFilter(resources) {
    var filtersParams = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    if (!Object.keys(filtersParams).length) {
      return resources;
    }

    return resources.filter(function (resource) {
      return Object.keys(filtersParams).every(function (filterKey) {
        var resourceValue = resource[filterKey];
        var filterValue = filtersParams[filterKey];

        return angular.isArray(filterValue) ? filterValue.some(function (value) {
          return value === resourceValue;
        }) : // In for array
        filterValue === resourceValue; // Equal for single value
      });
    });
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

    for (i = 0; i < sqlResultSet.rows.length; i++) {
      datas[i] = unserializePayloadColumn(sqlResultSet, i);
    }
    return datas;
  }

  /**
   * @param   {FiltersParameters} filtersParams -
   * @returns {SanitizedFiltersParameters}               - 
   */
  function sanitizeFiltersValues(filtersParams) {
    return Object.keys(filtersParams).reduce(function (filtersHash, filterKey) {
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
    var isIndexed = function isIndexed(filterKey) {
      return -1 !== indexedColumns.indexOf(filterKey) || 'id' === filterKey;
    };

    return Object.keys(filtersParams).reduce(function (indexedQueries, filterKey) {
      if (!isIndexed(filterKey)) {
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
    var isIndexed = function isIndexed(filterKey) {
      return -1 !== indexedColumns.indexOf(filterKey) || 'id' === filterKey;
    };

    return Object.keys(filtersParams).reduce(function (indexedQueries, filterKey) {
      if (isIndexed(filterKey)) {
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
    return array.map(function () {
      return '?';
    }).join(',');
  }

  /**
   * @param   {any}                   value -
   * @returns {Exclude<any, boolean>}       -
   */
  function boolToInteger(value) {
    return isBoolean(value) ? value ? 1 : 0 : value;
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
    var len = array.length;
    var nbOfSlices = Math.ceil(len / size);
    var sliced = [];
    var i = 0;
    var start = 0;
    var end = 0;

    for (; i < nbOfSlices; i++) {
      start = i * size;
      end = (i + 1) * size;
      sliced.push(array.slice(start, end));
    }

    return sliced;
  }

  /**
   * @param   {any}      input -
   * @returns {boolean}        -
   */
  function isRegExp(input) {
    return '[object RegExp]' === Object.prototype.toString.call(input);
  }

  /**
   * Some values need to be transformed in order to be injected into SQL expressions
   * @param   {any}                  filterValue -
   * @returns {Exclude<any, RegExp>}             -
   */
  function filterValuesToSQLBindingsValues(filterValue) {
    return isRegExp(filterValue) ? '%' + filterValue.source + '%' : // regexp source need to be used as string with %%
    filterValue;
  }
})(window.angular);