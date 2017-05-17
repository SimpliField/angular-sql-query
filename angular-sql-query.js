'use strict';

(function iife() {
  'use strict';

  SqlQueryService.$inject = ["$log", "$q"];
  var PARAMS_LIMIT = 100;
  var NB_PARAMS_MAX = 500;

  angular.module('sf.sqlQuery', []).factory('SqlQueryService', SqlQueryService);

  // @ngInject
  function SqlQueryService($log, $q) {

    function SqlQuery(name, databaseFn) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      var indexedFields = options.indexed_fields || [];
      var fields = concatAndDedup(['id', 'payload'], indexedFields);

      this.options = options;
      this.backUpName = name;
      this.helpers = { fields: fields };

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

      return this.execute(request).then(transformResults).catch(function (err) {
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
      var request = prepareSelect(_this.backUpName, ['id']);

      return this.execute(request, [entryId]).then(function (doc) {
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
      var indexedFields = _this.options.indexed_fields || [];
      var castedParams = castParamsForQuery(params || {});
      var indexedParams = getIndexedParams(indexedFields, castedParams);
      var organizedIndexedParams = organiseIndexedParamsForQuery(indexedParams);
      var tmpQueries = buildInsertTmpTablesQueries(_this.backUpName, organizedIndexedParams);
      var tmpTablesQueries = tmpQueries.map(function (queries) {
        return _this.batch(queries);
      }).reduce(function (arr, queries) {
        return arr.concat(queries);
      }, []);

      return $q.all(tmpTablesQueries).then(function onceCreated() {
        var query = buildSimpleQuery(_this.backUpName, organizedIndexedParams);

        return _this.execute(query.request, query.data).then(function (docs) {
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
      // Datas
      var requestValues = ConstructRequestValues.call(_this, entry);
      // Request
      var request = ConstructInsertRequest.call(_this, [entry]);

      return this.execute(request, [entry.id].concat(requestValues)).then(function () {
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
      // Datas
      var requestValues = ConstructRequestValues.call(_this, entry);
      // Request
      var fields = _this.helpers.fields.slice(1);
      var dataDefinition = fields.map(function (field) {
        return field + '=?';
      }).join(', ');
      var request = 'UPDATE ' + _this.backUpName + ' SET ' + dataDefinition + ' WHERE id=?';

      return this.execute(request, requestValues.concat([entry.id])).then(function () {
        return entry;
      }).catch(function (err) {
        $log.error('[Backup] Update', _this.backUpName, ':', err.message);
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
      var request = ConstructDeleteRequest.call(_this);

      return this.execute(request, [dataId]).catch(function (err) {
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

      var queries = [];

      // Deleted
      var deleteIds = _datas.filter(function (entry) {
        return entry._deleted;
      }).map(function (entry) {
        return entry.id;
      });
      var upsertDatas = _datas.filter(function (entry) {
        return !entry._deleted;
      }).map(function (entry) {
        return [entry.id].concat(ConstructRequestValues.call(_this, entry));
      });

      // Delete what has to be deleted
      if (deleteIds.length) {
        queries.push({
          query: ConstructDeleteRequest.call(this, deleteIds),
          params: deleteIds
        });
      }
      // Upsert what has to be upserted
      if (upsertDatas.length) {
        queries.push({
          query: ConstructInsertRequest.call(_this, upsertDatas),
          // Flatten upsertDatas
          params: upsertDatas.reduce(function (datas, upsert) {
            return datas.concat(upsert);
          }, [])
        });
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
     * @param  {Object} queries - An array containing the request and the params
     *                           of the batches
     *  {String} queries.query - Query to execute
     *  {Array} queries.params - Query params
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function batch(queries) {
      var q = $q.defer();

      this.backUpDB().then(function (database) {
        database.transaction(function (tx) {
          queries.forEach(function queryDb(query) {
            $log.info('SQLite Bulk', query.query, query.params);
            tx.executeSql(query.query, query.params || [], txs, txe);
          });
        }, function (err) {
          return q.reject(err);
        }, function (res) {
          return q.resolve(res);
        });
      });

      return q.promise;

      function txs(tx, res) {
        $log.info(res);
      }
      function txe(tx, err) {
        $log.error(err);
      }
    }

    /**
     * Construct the method to delete datas
     *
     * @param  {[Number]} datas - Datas to delete
     * @return {[String]}       - Delete request
     * @this SqlQueryService
     */
    function ConstructDeleteRequest() {
      var datas = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];

      var statement = 'DELETE FROM ' + this.backUpName + ' WHERE id';
      var questionsMark = getMarks(datas);
      var query = 1 < datas.length ? ' IN (' + questionsMark + ')' : '=?';

      return '' + statement + query;
    }

    /**
     * Construct the method to update database
     *
     * @param  {Array}  datas   - Datas to add in database
     * @return {String}            - Update request
     */
    function ConstructInsertRequest(datas) {
      var statement = 'INSERT OR REPLACE INTO';
      var fields = this.helpers.fields;
      var questionsMark = getMarks(fields);
      var fieldsRequest = '(' + fields.join(', ') + ')';
      var params = 1 < datas.length ? prepareInsertUnionQuery(datas, fields) : 'VALUES (' + questionsMark + ')';

      return [statement, this.backUpName, fieldsRequest, params].join(' ');
    }

    /**
     * Get an array of the values to call with the query
     *
     * @param  {Object} data        - Object data
     * @return {Array}              - Datas to past to the request
     */
    function ConstructRequestValues(data) {
      var indexedFields = this.options.indexed_fields || [];
      var additionalDatas = indexedFields.map(function (indexField) {
        var value = data[indexField];
        var castValue = castBooleanValue(value);

        return angular.isDefined(castValue) ? castValue : null;
      });

      return [angular.toJson(data)].concat(additionalDatas);
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

    return SqlQuery;
  }

  /**
   * Concat and dedup two arrays
   *
   * @param {Array} arr1  - First array
   * @param {Array} arr2  - First array
   * @return {Array}      - Concated and deduped resulting array
   */
  function concatAndDedup() {
    var arr1 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
    var arr2 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

    return arr1.concat(arr2).reduce(function (accu, el) {
      return -1 === accu.indexOf(el) ? accu.concat(el) : accu;
    }, []);
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

  function buildSimpleQuery(name, queryAsObject) {
    var preparedQueryObject = Object.keys(queryAsObject.self).reduce(function buildQueryPart(data, column) {
      var value = queryAsObject.self[column];

      data.data = data.data.concat(value);
      data.queryParts.push(column + (!angular.isArray(value) ? '=?' : ' IN (' + value.map(function () {
        return '?';
      }).join(',') + ')'));

      return data;
    }, { data: [], queryParts: [] });

    preparedQueryObject = Object.keys(queryAsObject.ext).reduce(function buildQueryPart(data, column) {
      var cTmpName = 'tmp_' + name + '_' + column;

      data.queryParts.push(column + ' IN (SELECT value FROM ' + cTmpName + ')');

      return data;
    }, preparedQueryObject);

    preparedQueryObject.request = prepareSelect(name) + (preparedQueryObject.queryParts.length ? ' WHERE ' : '') + preparedQueryObject.queryParts.join(' AND ') + ';';

    return preparedQueryObject;
  }

  function prepareSelect(tableName) {
    var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

    var selectRequest = 'SELECT * FROM ' + tableName;
    var selectRequestParams = params.map(function (param) {
      return param + '=?';
    }).join(' AND ');

    return selectRequestParams ? selectRequest + ' WHERE ' + selectRequestParams : selectRequest;
  }
  function prepareSelectAs(fields) {
    var allFields = [].concat(fields).map(function (field) {
      return '? as ' + field;
    }).join(', ');

    return 'SELECT ' + allFields;
  }
  function prepareInsertUnionQuery(datas, fields) {
    var arrFields = [].concat(fields);
    var questionsMark = getMarks(arrFields);
    var selectAs = prepareSelectAs(arrFields);

    return datas.map(function (data, index) {
      return 0 === index ? selectAs : 'UNION ALL SELECT ' + questionsMark;
    }).join(' ');
  }

  function getRowPayload(doc, nbItem) {
    return angular.fromJson(doc.rows.item(nbItem).payload);
  }
  function getMarks(datas) {
    return datas.map(function () {
      return '?';
    }).join(',');
  }
  function isBoolean(value) {
    return 'boolean' === typeof value;
  }
  function castBooleanValue(value) {
    return isBoolean(value) ? value ? 1 : 0 : value;
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