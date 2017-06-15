'use strict';

(function iife() {
  'use strict';

  SqlQueryService.$inject = ["$log", "$q"];
  var PARAMS_LIMIT = 100;
  var NB_PARAMS_MAX = 300;

  angular.module('sf.sqlQuery', []).factory('SqlQueryService', SqlQueryService);

  // @ngInject
  function SqlQueryService($log, $q) {

    function SqlQuery(name, databaseFn) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      var indexedFields = options.indexed_fields || [];

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

      return this.execute(request.query).then(transformResults).catch(function (err) {
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
        id: entryId
      });

      return this.execute(request.query, request.params).then(function (doc) {
        return doc.rows.length ? getRowPayload(doc, 0) : $q.reject({ message: 'Not Found', status: 404 });
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
     * @param  {Object} params - Request Params
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function queryBackUp(params) {
      var _this = this;
      var indexedFields = _this.helpers.indexed_fields;
      var castedParams = castParamsForQuery(params || {});
      var indexedParams = getIndexedParams(indexedFields, castedParams);
      var organizedIndexedParams = organiseIndexedParamsForQuery(indexedParams);
      var tmpQueries = buildInsertTmpTablesQueries(_this.backUpName, organizedIndexedParams);
      var tmpTablesQueries = tmpQueries.reduce(function (arr, queries) {
        return arr.concat(queries);
      }, []);
      var batchPromise = tmpTablesQueries.length ? _this.batch(tmpTablesQueries) : $q.when();

      return batchPromise.then(function onceCreated() {
        var query = prepareSimpleQuery(_this.backUpName, organizedIndexedParams);

        return _this.execute(query.query, query.params).then(function (docs) {
          var datas = transformResults(docs);
          var nonIndexedParams = getNonIndexedParams(indexedFields, castedParams);

          // Non indexedFields filtering
          return filterDatas(datas, nonIndexedParams);
        });
      }).catch(function (err) {
        $log.error('[Backup] Query', _this.backUpName, ':', err.message);
        throw err;
      });

      function organiseIndexedParamsForQuery(_indexedParams) {
        return Object.keys(_indexedParams).reduce(function (accu, columnName) {
          var value = _indexedParams[columnName];
          var valueIsAnArray = angular.isArray(value);

          if (valueIsAnArray && PARAMS_LIMIT < value.length) {
            accu.ext[columnName] = value;
          } else {
            accu.self[columnName] = value;
          }

          return accu;
        }, {
          self: {},
          ext: {}
        });
      }

      function buildInsertTmpTablesQueries(name, _params) {
        var tmpName = 'tmp_' + name + '_';

        return Object.keys(_params.ext || {}).map(function (key) {
          var cTmpName = tmpName + key;
          var dropTableQuery = 'DROP TABLE IF EXISTS ' + cTmpName;
          var createTableQuery = 'CREATE TABLE IF NOT EXISTS ' + cTmpName + ' (value TEXT)';
          var insertQuery = buildInsertQueryWith(cTmpName, 'value', _params.ext[key]);

          return [{ query: dropTableQuery }, { query: createTableQuery }].concat(insertQuery);
        });
      }

      function buildInsertQueryWith(table, column, data) {
        var nbBySlice = NB_PARAMS_MAX;
        var sliced = splitInSlice(data, nbBySlice);

        return sliced.map(function (slice) {
          var query = 'INSERT INTO ' + table;
          var sliceQuery = prepareInsertUnionQuery(slice, column);

          return {
            query: query + ' ' + sliceQuery,
            params: slice
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
      var _this = this;
      var indexedFields = _this.helpers.indexed_fields;
      var tableName = this.backUpName;
      // Request
      var request = prepareInsertRequest([entry], indexedFields, tableName);

      return this.execute(request.query, request.params).then(function () {
        return entry;
      }).catch(function (err) {
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
      var _this = this;
      var tableName = _this.backUpName;
      var indexedFields = _this.helpers.indexed_fields;
      var request = prepareUpdateRequest(entry, indexedFields, tableName);

      return this.execute(request.query, request.params).then(function () {
        return entry;
      }).catch(function (err) {
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

      return this.execute(request.query, request.params).catch(function (err) {
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
        queries.push(prepareDeleteRequest(deleteIds, tableName));
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
     * Make an SQLite request with the param query and params
     *
     * @param  {String} query  - SQL Query
     * @param  {[Array]} datas - Datas for querying
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function execute(query, datas) {
      var q = $q.defer();

      this.backUpDB().then(function (database) {
        database.transaction(function (tx) {
          tx.executeSql(query, datas, function (sqlTx, result) {
            q.resolve(result);
          }, function (transaction, error) {
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

      this.backUpDB().then(function (database) {
        return database.sqlBatch ? database.sqlBatch(queries.map(function (query) {
          return [query.query, query.params || []];
        }), function (res) {
          return q.resolve(res);
        }, function (err) {
          return q.reject(err);
        }) : batchFallback(database).then(q.resolve).catch(q.reject);
      });

      return q.promise;

      function batchFallback(database) {
        var qFallback = $q.defer();

        database.transaction(function (tx) {
          queries.forEach(function queryDb(query) {
            $log.info('SQLite Bulk', query.query, query.params);
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
  function prepareSimpleQuery(tableName, queryAsObject) {
    return {
      query: getSimpleQuery(queryAsObject),
      params: Object.keys(queryAsObject.self).reduce(function (arr, column) {
        return arr.concat(queryAsObject.self[column]);
      }, [])
    };

    function getSimpleQuery(queryObject) {
      var statement = 'SELECT * FROM ' + tableName;
      var queries = [].concat(getSelfQuery(queryObject.self), getExtQuery(queryObject.ext));
      var whereDefinition = queries.length ? ' WHERE ' : '';
      var andDefinition = queries.join(' AND ');
      var dataDefinition = '' + whereDefinition + andDefinition + ';';

      return statement + dataDefinition;
    }
    function getSelfQuery(self) {
      return Object.keys(self).map(function (column) {
        var value = queryAsObject.self[column];
        var queryParams = !angular.isArray(value) ? '=?' : ' IN (' + getMarks(value) + ')';

        return column + queryParams;
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
   * @param  {String} tableName - Name of the table
   * @param  {Object}  params   - Params to query with
   * @return {String}           - Update query + associated request params
   */
  function prepareSelect(tableName) {
    var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    var statement = 'SELECT * FROM ' + tableName;
    var queryParamsKeys = Object.keys(params);
    var dataDefinition = queryParamsKeys.map(function (paramKey) {
      return paramKey + '=?';
    }).join(' AND ');
    var queryParamsValues = queryParamsKeys.map(function (paramKey) {
      return params[paramKey];
    });

    return {
      query: dataDefinition ? statement + ' WHERE ' + dataDefinition : statement,
      params: queryParamsValues
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
    var statement = 'INSERT OR REPLACE INTO ' + tableName;
    var allFields = ['id', 'payload'].concat(indexedFields);
    var questionsMark = getMarks(allFields);
    var fieldsRequest = '(' + allFields.join(', ') + ')';
    var params = 1 < entries.length ? prepareInsertUnionQuery(entries, allFields) : 'VALUES (' + questionsMark + ')';

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
    var questionsMark = getMarks(arrFields);
    var selectAs = prepareSelectAs(arrFields);

    return datas.map(function (data, index) {
      return 0 === index ? selectAs : 'UNION ALL SELECT ' + questionsMark;
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
   * @param  {Array}  entry         - Entry to update
   * @param  {String} indexedFields - Indexed fields of the table
   * @param  {String} tableName     - Name to the table to update
   * @return {Object}             - Update query + associated request params
   */
  function prepareUpdateRequest(entry, indexedFields, tableName) {
    var statement = 'UPDATE ' + tableName;
    var fields = ['payload'].concat(indexedFields);
    // Datas
    var requestValues = prepareRequestValues(entry, indexedFields);
    // Request
    var dataDefinition = fields.map(function (field) {
      return field + '=?';
    }).join(', ');

    return {
      query: statement + ' SET ' + dataDefinition + ' WHERE id=?',
      params: requestValues.concat([entry.id])
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
    var statement = 'DELETE FROM ' + tableName + ' WHERE id';
    var questionsMark = getMarks(ids);
    var query = 1 < ids.length ? ' IN (' + questionsMark + ')' : '=?';

    return {
      query: '' + statement + query,
      params: ids
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

    return [angular.toJson(entry)].concat(entryDataFields);
  }
  function getFieldsData(entry, fields) {
    return fields.map(function (field) {
      var value = entry[field];
      var castValue = castBooleanValue(value);

      return angular.isDefined(castValue) ? castValue : null;
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
    if (!Object.keys(params).length) {
      return datas;
    }

    return datas.filter(function (data) {
      return Object.keys(params || {}).every(function (key) {
        var currentData = data[key];
        var paramValue = params[key];

        return angular.isArray(paramValue) ? paramValue.some(function (value) {
          return value === currentData;
        }) : paramValue === currentData;
      });
    });
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

    for (i = 0; i < docs.rows.length; i++) {
      datas[i] = getRowPayload(docs, i);
    }
    return datas;
  }

  function castParamsForQuery(queryAsObject) {
    return Object.keys(queryAsObject).reduce(function cast(castedQuery, queryKey) {
      var queryValue = queryAsObject[queryKey];
      var castValue = castBooleanValue(queryValue);

      castedQuery[queryKey] = castValue;

      return castedQuery;
    }, {});
  }

  function getNonIndexedParams(arrOfIndexes, queryAsObject) {
    return Object.keys(queryAsObject).reduce(function extractNonIndexedQueries(nonIndexedQueries, queryKey) {
      if (!isAnIndexedParam(queryKey, arrOfIndexes)) {
        nonIndexedQueries[queryKey] = queryAsObject[queryKey];
      }
      return nonIndexedQueries;
    }, {});
  }

  function getIndexedParams(arrOfIndexes, queryAsObject) {
    return Object.keys(queryAsObject).reduce(function extractIndexedQueries(indexedQueries, queryKey) {
      if (isAnIndexedParam(queryKey, arrOfIndexes)) {
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
    return datas.map(function () {
      return '?';
    }).join(',');
  }
  function castBooleanValue(value) {
    return isBoolean(value) ? value ? 1 : 0 : value;
  }
  function isBoolean(value) {
    return 'boolean' === typeof value;
  }

  function splitInSlice(data, nbBySlice) {
    var len = data.length;
    var nbOfSlices = Math.ceil(len / nbBySlice);
    var sliced = [];
    var i = 0;
    var start = 0;
    var end = 0;

    for (; i < nbOfSlices; i++) {
      start = i * nbBySlice;
      end = (i + 1) * nbBySlice;
      sliced.push(data.slice(start, end));
    }

    return sliced;
  }
})();