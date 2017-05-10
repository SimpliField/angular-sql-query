'use strict';

(function iife() {
  'use strict';

  SqlQueryService.$inject = ["$log", "$q"];
  var PARAMS_LIMIT = 100;

  angular.module('sf.sqlQuery', []).factory('SqlQueryService', SqlQueryService);

  // @ngInject
  function SqlQueryService($log, $q) {

    function SqlQuery(name, databaseFn) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      var indexedFields = options.indexed_fields || [];
      var fields = concatAndDedup(['id', 'payload'], indexedFields);
      var questionsMark = fields.map(function () {
        return '?';
      }).join(',');
      /*
      questionsMark = '?,?' + indexedFields.reduce(function(data) {
        return data + ',?';
      }, '');
      */

      this.options = options;
      this.backUpName = name;
      this.helpers = {
        fields: fields,
        questionsMark: questionsMark
      };

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
      var request = 'SELECT * FROM ' + _this.backUpName;

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
      var request = 'SELECT * FROM ' + _this.backUpName + ' WHERE id=?';

      return this.execute(request, [entryId]).then(function (doc) {
        return doc.rows.length ? angular.fromJson(doc.rows.item(0).payload) : $q.reject({ message: 'Not Found', status: 404 });
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
      var nonIndexedParams = getNonIndexedParams(indexedFields, castedParams);
      var indexedParams = getIndexedParams(indexedFields, castedParams);
      var organizedIndexedParams = organiseIndexedParamsForQuery(indexedParams);

      // var query = buildSimpleQuery(_this.backUpName, indexedParams);
      return $q.all(buildInsertTmpTablesQueries(_this.backUpName, organizedIndexedParams).map(function (queries) {
        return _this.batch(queries);
      })).then(function onceCreated() {
        var query = buildSimpleQuery(_this.backUpName, organizedIndexedParams);

        return _this.execute(query.request, query.data).then(function (docs) {
          var datas = transformResults(docs);

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

          return [['DROP TABLE IF EXISTS ' + cTmpName], ['CREATE TABLE IF NOT EXISTS ' + cTmpName + ' (value TEXT)']].concat(buildInsertQueryWith(cTmpName, 'value', _params.ext[key]));
        });
      }

      function buildInsertQueryWith(table, column, data) {
        var LIMIT = 500;
        var len = data.length;
        var nbOfSlices = Math.ceil(len / LIMIT);
        var sliced = [];
        var i;

        for (i = 0; i < nbOfSlices; i++) {
          sliced.push(data.slice(i * LIMIT, (i + 1) * (LIMIT - 1)));
        }

        return sliced.map(function (slice) {
          var query = 'INSERT INTO ' + table;

          return slice.reduce(function (accu, piece, index) {
            if (0 === index) {
              accu[0] += ' SELECT ? as ' + column;
            } else {
              accu[0] += ' UNION ALL SELECT ?';
            }

            accu[1].push(piece);

            return accu;
          }, [query, []]);
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
      var requestDatas = ConstructRequestValues.call(_this, entryId, entry);
      // Request
      var request = ConstructInsertRequest.call(_this, true);

      return this.execute(request, requestDatas).then(function () {
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
      var requestDatas = ConstructRequestValues.call(_this, entry.id, entry, true);
      // Request
      var fields = _this.helpers.fields.slice(1);
      var dataDefinition = fields.map(function (field) {
        return field + '=?';
      }).join(', ');
      var request = 'UPDATE ' + _this.backUpName + ' SET ' + dataDefinition + ' WHERE id=?';

      return this.execute(request, requestDatas).then(function () {
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
      var upsertDatas = [];
      var deleteIds = [];

      // Organise datas to make the right requests.
      _datas.forEach(function (data) {
        var isDeleted = data._deleted;

        if (isDeleted) {
          deleteIds.push(data.id);
        } else {
          upsertDatas.push(ConstructRequestValues.call(_this, data.id, data));
        }
      });

      // Delete what has to be deleted
      if (deleteIds.length) {
        queries.push({
          query: ConstructDeleteRequest.call(this, deleteIds.length),
          params: deleteIds
        });
      }
      // Upsert what has to be upserted
      if (upsertDatas.length) {
        queries.push({
          query: ConstructInsertRequest.call(_this, true, upsertDatas.length),
          // Flatten upsertDatas
          params: upsertDatas.reduce(function (datas, upsert) {
            return datas.concat(upsert);
          }, [])
        });
      }

      // Return if not datas to update
      if (!queries.length) {
        return $q.when();
      }

      return $q.all(queries.map(function (query) {
        return _this.execute(query.query, query.params);
      })).catch(function (err) {
        $log.error('[Backup] Bulk', _this.backUpName, ':', err.message);
        throw err;
      });
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
     * @return {Promise}       - Request result
     * @this SqlQueryService
     */
    function batch(queries) {
      var q = $q.defer();

      this.backUpDB().then(function (database) {
        database.transaction(function (tx) {
          queries.forEach(function queryDb(query) {
            $log.info('SQLite Bulk', query[0], query[1]);
            tx.executeSql(query[0], query[1] || [], txs, txe);
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
     * @param  {[Number]} nbDatas - Number of datas to delete
     * @return {[String]}         - Delete request
     * @this SqlQueryService
     */
    function ConstructDeleteRequest(nbDatas) {
      var statement = 'DELETE FROM ' + this.backUpName + ' WHERE id';
      var query = '';
      var questionsMark = [];
      var i = 0;

      nbDatas = nbDatas || 1;

      if (1 < nbDatas) {
        for (i = 0; i < nbDatas; i++) {
          questionsMark.push('?');
        }
        query = ' IN (' + questionsMark.join(',') + ')';
      } else {
        query = '=?';
      }

      return statement + query;
    }

    /**
     * Construct the method to update database
     *
     * @param  {[Boolean]} replace - If request need to replace datas if exists
     * @param  {[Number]}  nbDatas - Nb of datas to include in database
     * @return {String}            - Update request
     */
    function ConstructInsertRequest(replace, nbDatas) {
      var statement = 'INSERT ' + (replace ? 'OR REPLACE ' : '') + 'INTO';

      var params = '';
      var fields = this.helpers.fields;
      var questionsMark = this.helpers.questionsMark;
      var fieldsRequest = '(' + fields.join(', ') + ')';
      var i = 0;

      nbDatas = nbDatas || 1;

      params = 1 < nbDatas ? constructQuery(fields, questionsMark) : params = 'VALUES (' + questionsMark + ')';

      function constructQuery() {
        var multiUpdateParams = [];

        for (i = 0; i < nbDatas; i++) {
          multiUpdateParams.push(0 === i ? 'SELECT ' + fields.map(setParamName).join(', ') : 'UNION ALL SELECT ' + questionsMark);
        }

        return multiUpdateParams.join(' ');
      }

      function setParamName(indexed_field) {
        return '? as ' + indexed_field;
      }

      return [statement, this.backUpName, fieldsRequest, params].join(' ');
    }

    /**
     * Set the values to inject in request
     *
     * @param  {String} dataId      - Id of the object
     * @param  {Object} data        - Object data
     * @param  {[Booleat]} idAtLast - Add data id to the last index of the array
     * @return {Array}              - Datas to past to the request
     */
    function ConstructRequestValues(dataId, data, idAtLast) {
      var indexedFields = this.options.indexed_fields || [];
      var additionalDatas = indexedFields.map(function (indexField) {
        var value = data[indexField];

        return 'boolean' === typeof value ? value ? 1 : 0 : angular.isDefined(value) ? value : null;
      });
      var values = [angular.toJson(data)].concat(additionalDatas);

      values[idAtLast ? 'push' : 'unshift'](dataId);

      return values;
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
        datas[i] = angular.fromJson(docs.rows.item(i).payload);
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
  function concatAndDedup(arr1, arr2) {
    return (arr1 || []).concat(arr2 || []).reduce(function dedup(accu, el) {
      if (-1 === accu.indexOf(el)) {
        accu.push(el);
      }
      return accu;
    }, []);
  }

  function castParamsForQuery(queryAsObject) {
    return Object.keys(queryAsObject).reduce(function cast(castedQuery, queryKey) {
      var queryValue = queryAsObject[queryKey];

      castedQuery[queryKey] = 'boolean' === typeof queryValue ? queryValue ? 1 : 0 : queryValue;

      return castedQuery;
    }, {});
  }

  function getNonIndexedParams(arrOfIndexes, queryAsObject) {
    return Object.keys(queryAsObject).reduce(function extractNonIndexedQueries(nonIndexedQueries, queryKey) {
      if (-1 === arrOfIndexes.indexOf(queryKey) && 'id' !== queryKey) {
        nonIndexedQueries[queryKey] = queryAsObject[queryKey];
      }
      return nonIndexedQueries;
    }, {});
  }

  function getIndexedParams(arrOfIndexes, queryAsObject) {
    return Object.keys(queryAsObject).reduce(function extractIndexedQueries(indexedQueries, queryKey) {
      if (-1 !== arrOfIndexes.indexOf(queryKey) || 'id' === queryKey) {
        indexedQueries[queryKey] = queryAsObject[queryKey];
      }
      return indexedQueries;
    }, {});
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

    preparedQueryObject.request = 'SELECT * FROM ' + name + (preparedQueryObject.queryParts.length ? ' WHERE ' : '') + preparedQueryObject.queryParts.join(' AND ') + ';';

    return preparedQueryObject;
  }
})();