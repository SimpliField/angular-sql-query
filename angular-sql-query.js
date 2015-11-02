(function() {
  'use strict';

  angular
    .module('sf.sqlQuery', [])
    .factory('SqlQueryService', SqlQueryService);

  // @ngInject
  function SqlQueryService($log, $q) {

    function SqlQuery(name, databaseFn, options) {
      var indexedFields;
      var fields;
      var questionsMark;

      this.options = options || {};

      indexedFields = this.options.indexed_fields || [];
      fields = ['id', 'payload'].concat(indexedFields);
      questionsMark = '?,?' + indexedFields.reduce(function(data) {
        return data + ',?';
      }, '');

      this.backUpName = name;
      this.helpers = {
        fields: fields,
        questionsMark: questionsMark,
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

    //-----------------
    //
    //  GET Methods
    //
    //-----------------
    function listBackUp() {
      var _this = this;
      var request = 'SELECT * FROM ' + _this.backUpName;

      return this.execute(request).then(transformResults).catch(function(err) {
        $log.error('[Backup] List', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    function getBackUp(backUpId) {
      var _this = this;
      var request = 'SELECT * FROM ' + _this.backUpName + ' WHERE id=?';

      return this.execute(request, [backUpId]).then(function(doc) {
        return (doc.rows.length) ?
          angular.fromJson(doc.rows.item(0).payload) :
          $q.reject({ message: 'Not Found', status: 404 });
      }).catch(function(err) {
        $log.error('[Backup] Get', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    function queryBackUp(params) {
      var _this = this;
      var lastParams = {};
      var indexedFields = _this.options.indexed_fields || [];
      var queryDatas = [];
      var request;
      var methodParams = params || {};
      var queryFields = Object.keys(methodParams || {}).filter(function(paramKey) {
        var isIndexed = (-1 !== indexedFields.indexOf(paramKey));
        var paramValue = methodParams[paramKey];

        // Transform if value is a boolean
        methodParams[paramKey] = ('boolean' === typeof paramValue) ?
          ((paramValue) ? 1 : 0) :
          paramValue;

        if(!isIndexed) { lastParams[paramKey] = methodParams[paramKey]; }
        return isIndexed;
      });
      // SQL Query
      var queries = queryFields.map(function(queryField) {
        var paramValue = methodParams[queryField];
        var query = '';

        if (angular.isArray(paramValue)) {
          query = queryField + ' IN (' + paramValue.map(function(value) {
            queryDatas.push(value);
            return '?';
          }).join(',') + ')';
        } else {
          queryDatas.push(paramValue);
          query = queryField + '=?';
        }

        return query;
      }).join(' AND ');

      if(queryFields.length) {
        queries = ' WHERE ' + queries;
      }

      request = 'SELECT * FROM ' + _this.backUpName + queries;

      return this.execute(request, queryDatas).then(function(docs) {
        var datas = transformResults(docs);

        // Filter last datas if needed
        return filterDatas(datas, lastParams);
      }).catch(function(err) {
        $log.error('[Backup] Query', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    //-----------------
    //
    //  Modify Methods
    //
    //-----------------
    // CREATE
    function saveBackUp(backUpId, datas) {
      var _this = this;
      // Datas
      var requestDatas = ConstructRequestValues.call(_this, backUpId, datas);
      // Request
      var request = ConstructInsertRequest.call(_this, true);

      return this.execute(request, requestDatas).then(function() {
        return datas;
      }).catch(function(err) {
        $log.error('[Backup] Save', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    // UPDATE
    function updateBackUp(datas) {
      var _this = this;
      // Datas
      var requestDatas = ConstructRequestValues.call(_this, datas.id, datas, true);
      // Request
      var fields = _this.helpers.fields.slice(1);
      var dataDefinition = fields.map(function(field) {
        return field + '=?';
      }).join(', ');
      var request = 'UPDATE ' + _this.backUpName + ' SET ' + dataDefinition + ' WHERE id=?';

      return this.execute(request, requestDatas).then(function() {
        return datas;
      }).catch(function(err) {
        $log.error('[Backup] Update', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    // REMOVE
    function removeBackUp(dataId) {
      var _this = this;
      var request = ConstructDeleteRequest.call(_this);

      return this.execute(request, [dataId]).catch(function(err) {
        $log.error('[Backup] Remove', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    function bulkDocsBackUp(_datas) {
      var _this = this;

      var queries = [];

      // Deleted
      var upsertDatas = [];
      var deleteIds = [];

      // Organise datas to make the right requests.
      _datas.forEach(function(data) {
        var isDeleted = data._deleted;

        if(isDeleted) {
          deleteIds.push(data.id);
        } else {
          upsertDatas.push(ConstructRequestValues.call(_this, data.id, data));
        }
      });

      // Delete what has to be deleted
      if(deleteIds.length) {
        queries.push({
          query: ConstructDeleteRequest.call(this, deleteIds.length),
          params: deleteIds,
        });
      }
      // Upsert what has to be upserted
      if(upsertDatas.length) {
        queries.push({
          query: ConstructInsertRequest.call(_this, true, upsertDatas.length),
          // Flatten upsertDatas
          params: upsertDatas.reduce(function(datas, upsert) {
            return datas.concat(upsert);
          }, []),
        });
      }

      // Return if not datas to update
      if(!queries.length) { return $q.when(); }

      return $q.all(queries.map(function(query) {
        return _this.execute(query.query, query.params);
      })).catch(function(err) {
        $log.error('[Backup] Bulk', _this.backUpName, ':', err.message);
        throw err;
      });
    }

    //-----------------
    //
    //    HELPERS
    //
    //-----------------
    /**
     * Make SQLite request
     *
     * @param  {String} query  - SQL Query
     * @param  {[Array]} datas - Datas for querying
     * @return {Promise}       - Request result
     */
    function execute(query, datas) {
      var q = $q.defer();

      this.backUpDB().then(function(database) {
        database.transaction(function(tx) {
          tx.executeSql(query, datas, function(sqlTx, result) {
            q.resolve(result);
          }, function(transaction, error) {
            q.reject(error);
          });
        });
      });

      return q.promise;
    }

    /**
     * Construct the method to delete datas
     *
     * @param  {[Number]} nbDatas - Number of datas to delete
     * @return {[String]}         - Delete request
     */
    function ConstructDeleteRequest(nbDatas) {
      var statement = 'DELETE FROM ' + this.backUpName + ' WHERE id';
      var query = '';
      var questionsMark = [];
      var i = 0;

      nbDatas = nbDatas || 1;

      if(1 < nbDatas) {
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
      var statement = 'INSERT ' + ((replace) ? 'OR REPLACE ' : '') + 'INTO';

      var params = '';
      var fields = this.helpers.fields;
      var questionsMark = this.helpers.questionsMark;
      var fieldsRequest = '(' + fields.join(', ') + ')';
      var i = 0;

      nbDatas = nbDatas || 1;

      params = (1 < nbDatas) ?
        constructQuery(fields, questionsMark) :
        params = 'VALUES (' + questionsMark + ')';

      function constructQuery() {
        var multiUpdateParams = [];

        for (i = 0; i < nbDatas; i++) {
          multiUpdateParams.push((0 === i) ?
            ('SELECT ' + fields.map(setParamName).join(', ')) :
            'UNION ALL SELECT ' + questionsMark);
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
      var additionalDatas = indexedFields.map(function(indexField) {
        var value = data[indexField];

        return ('boolean' === typeof value) ?
          ((value) ? 1 : 0) :
          (angular.isDefined(value) ? value : null);
      });
      var values = [angular.toJson(data)].concat(additionalDatas);

      values[(idAtLast) ? 'push' : 'unshift'](dataId);

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
      return datas.filter(function(data) {
        return Object.keys(params || {}).every(function(key) {
          var currentData = data[key];
          var paramValue = params[key];

          return (angular.isArray(paramValue)) ?
            paramValue.some(function(value) {
              return value === currentData;
            }) :
            (paramValue === currentData);
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

      for(i = 0; i < docs.rows.length; i++) {
        datas[i] = angular.fromJson(docs.rows.item(i).payload);
      }
      return datas;
    }

    return SqlQuery;
  }
  SqlQueryService.$inject = ["$log", "$q"];
}());
