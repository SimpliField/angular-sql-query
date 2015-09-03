(function() {
  'use strict';

  describe('[SQL Query] Service', function() {
    var backUp;
    var executeStub;
    var executeSql = { executeSql: function() {} };
    var sqlInstance = {
      test: 'test',
      transaction: function(cb) { cb(executeSql); },
    };
    var datas = [
      { id: 1, test: 'test1', isOk: 0 },
      { id: 2, test: 'test2', isOk: 1 },
    ].map(function(data) {
      return angular.toJson(data);
    });
    var backupDatas = {
      rows: {
        item: function(i) {
          return { payload: datas[i] };
        },
        length: datas.length,
      },
    };

    // load the controller's module
    beforeEach(module('sf.sqlQuery', function($exceptionHandlerProvider) {
      $exceptionHandlerProvider.mode('log');
    }));

    // Initialize the controller and a mock scope
    beforeEach(inject(function(SqlQueryService, $q) {
      function dbInstance() { return $q.when(sqlInstance); }

      executeStub = sinon.stub(executeSql, 'executeSql');

      backUp = new SqlQueryService('test', dbInstance);
    }));
    afterEach(function() {
      executeStub.restore();
    });

    describe('Instantiate', function() {
      it('should instantiate Backup Class', inject(function($timeout) {
        var data;

        expect(backUp.backUpName).equal('test');

        backUp.backUpDB().then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(data.test).equal('test');
      }));
    });

    //---------------
    //
    //      List
    //
    //---------------
    describe('List', function() {
      it('should failed to list Backup datas', inject(function($q, $timeout, $exceptionHandler) {
        var data;

        executeStub.callsArgWith(3, 'test', 'fail');

        backUp.listBackUp().catch(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(data).equal('fail');
        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should list Backup datas', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', angular.copy(backupDatas));

        backUp.listBackUp().then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).equal('SELECT * FROM test');

        expect(data).lengthOf(2);
      }));
    });

    //---------------
    //
    //      Get
    //
    //---------------
    describe('Get', function() {
      it('should failed to get Backup data', inject(function($q, $timeout, $exceptionHandler) {
        executeStub.callsArgWith(3, 'test', {});
        backUp.getBackUp();

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should failed if data not find', inject(function($q, $timeout, $exceptionHandler) {
        var err;

        executeStub.yields('test', { rows: [] });

        backUp.getBackUp().catch(function(_err_) {
          err = _err_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('SELECT * FROM test');
        expect(executeStub.args[0][0]).contain('WHERE id=');

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err.status).equal(404);
      }));

      it('should get Backup data', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', angular.copy(backupDatas));

        backUp.getBackUp().then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('SELECT * FROM test');
        expect(executeStub.args[0][0]).contain('WHERE id=');

        expect(data.id).equal(1);
      }));
    });

    //---------------
    //
    //    Query
    //
    //---------------
    describe('Query', function() {
      it('should failed to query Backup datas', inject(function($q, $timeout, $exceptionHandler) {
        executeStub.callsArgWith(3, 'test', {});
        backUp.queryBackUp();

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should query Backup datas', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', angular.copy(backupDatas));

        // Common param
        backUp.queryBackUp({
          test: 'test1',
          isOk: false,
        }).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).equal('SELECT * FROM test');

        expect(data).lengthOf(1);
        expect(data[0].id).equal(1);

        // Array param
        data = null;
        backUp.queryBackUp({
          test: ['test1', 'test2'],
        }).then(function(_data_) {
          data = _data_;
        });
        $timeout.flush();

        expect(data).lengthOf(2);
        expect(data[0].id).equal(1);
        expect(data[1].id).equal(2);
      }));

      it('should query Backup datas with indexed fields',
      inject(function($q, $timeout, SqlQueryService) {
        var data;

        function dbInstance() { return $q.when(sqlInstance); }
        backUp = new SqlQueryService('test', dbInstance, {
          indexed_fields: ['test', 'test2'],
        });

        executeStub.yields('test', angular.copy(backupDatas));

        backUp.queryBackUp({
          test: 'test',
          isOk: true,
          test2: ['ok', 'not ok'],
        }).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).equal('SELECT * FROM test WHERE test=? AND test2 IN (?,?)');
        expect(executeStub.args[0][1][0]).equal('test');
        expect(executeStub.args[0][1][1]).equal('ok');
        expect(executeStub.args[0][1][2]).equal('not ok');

        expect(data).lengthOf(1);
      }));
    });

    //---------------
    //
    //    Update
    //
    //---------------
    describe('Update', function() {
      it('should failed to update Backup datas', inject(function($q, $timeout, $exceptionHandler) {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.updateBackUp(1, 'test').then(function(_err_) {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should succeed to update Backup datas', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', 'ok');

        backUp.updateBackUp({ id: 1, test: 'test' }).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('UPDATE test');
        expect(executeStub.args[0][1][1]).equal(1);

        expect(data).equal('ok');
      }));

      it('should succeed to update Backup datas with indexed fields',
      inject(function($q, $timeout, SqlQueryService) {
        var data;

        function dbInstance() { return $q.when(sqlInstance); }
        backUp = new SqlQueryService('test', dbInstance, {
          indexed_fields: ['test'],
        });

        executeStub.yields('test', 'ok');

        backUp.updateBackUp({
          id: 1,
          test: 'test',
        }).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('UPDATE test SET payload=?, test=? WHERE id=?');
        expect(executeStub.args[0][1][1]).equal('test');
        expect(executeStub.args[0][1][2]).equal(1);

        expect(data).equal('ok');
      }));
    });

    //---------------
    //
    //    Remove
    //
    //---------------
    describe('Remove', function() {
      it('should failed to remove Backup datas', inject(function($q, $timeout, $exceptionHandler) {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.removeBackUp(1).then(function(_err_) {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should succeed to remove Backup datas', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', 'ok');

        backUp.removeBackUp(1).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('DELETE FROM test');
        expect(executeStub.args[0][1][0]).equal(1);

        expect(data).equal('ok');
      }));
    });

    //---------------
    //
    //    Save
    //
    //---------------
    describe('Save', function() {
      it('should failed to save Backup', inject(function($q, $timeout, $exceptionHandler) {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.saveBackUp(1, 'test').then(function(_err_) {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should succeed to create or save backup', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', 'ok');

        backUp.saveBackUp(1, 'test').then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('INSERT OR REPLACE INTO test');
        expect(executeStub.args[0][1][0]).equal(1);
        expect(executeStub.args[0][1][1]).equal('"test"');

        expect(data).equal('ok');
      }));
    });

    //---------------
    //
    //    Bulk
    //
    //---------------
    describe('Bulk', function() {
      it('should failed to bulk', inject(function($q, $timeout, $exceptionHandler) {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.bulkDocsBackUp([{ id: 1 }]).then(function(_err_) {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should do nothing', inject(function($q, $timeout) {
        var data = null;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([]).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(0);
        expect(data).equal({}.undef);
      }));

      it('should delete datas', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([{ id: 1, _deleted: true }]).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('DELETE FROM test');
        expect(executeStub.args[0][0]).not.contain('INSERT OR REPLACE');
        expect(executeStub.args[0][1][0]).equal(1);

        expect(data).deep.equal(['ok']);
      }));

      it('should modify datas', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([{ id: 1 }]).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).not.contain('DELETE FROM test');
        expect(executeStub.args[0][0]).contain('INSERT OR REPLACE');
        expect(executeStub.args[0][1][0]).equal(1);

        expect(data).deep.equal(['ok']);
      }));

      it('should modify and delete datas', inject(function($q, $timeout) {
        var data;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([
          { id: 1 },
          { id: 2, _deleted: true },
          { id: 3, _deleted: true },
          { id: 4 },
        ]).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(2);
        expect(executeStub.args[0][0]).contain('DELETE FROM test');
        expect(executeStub.args[0][1][0]).equal(2);
        expect(executeStub.args[0][1][1]).equal(3);
        expect(executeStub.args[1][0]).contain('INSERT OR REPLACE');
        expect(executeStub.args[1][0]).contain('SELECT ? as id, ? as payload UNION ALL SELECT ?,?');
        expect(executeStub.args[1][1][0]).equal(1);
        expect(executeStub.args[1][1][2]).equal(4);

        expect(data).deep.equal(['ok', 'ok']);
      }));

      it('should modify and delete datas whith indexed fields',
      inject(function($q, $timeout, SqlQueryService) {
        var queryFields = 'SELECT ? as id, ? as payload, ? as test UNION ALL SELECT ?,?,?';
        var data;

        function dbInstance() { return $q.when(sqlInstance); }
        backUp = new SqlQueryService('test', dbInstance, {
          indexed_fields: ['test'],
        });

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([
          { id: 1, test: 1 },
          { id: 4, test: 2 },
        ]).then(function(_data_) {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('INSERT OR REPLACE');
        expect(executeStub.args[0][0]).contain(queryFields);
        expect(executeStub.args[0][1][0]).equal(1);
        expect(executeStub.args[0][1][2]).equal(1);
        expect(executeStub.args[0][1][3]).equal(4);
        expect(executeStub.args[0][1][5]).equal(2);

        expect(data).deep.equal(['ok']);
      }));
    });

  });
}());
