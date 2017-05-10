/* eslint-disable no-magic-numbers, max-nested-callbacks */
(function iife() {
  'use strict';

  describe('[SQL Query] Service', () => {
    var backUp;
    var executeStub;
    var executeSql = { executeSql: () => {} };
    var sqlInstance = {
      test: 'test',
      transaction: cb => cb(executeSql),
    };
    var datas = [
      { id: 1, test: 'test1', isOk: 0 },
      { id: 2, test: 'test2', isOk: 1 },
    ].map(data => angular.toJson(data));
    var backupDatas = {
      rows: {
        item: i => ({ payload: datas[i] }),
        length: datas.length,
      },
    };

    // load the controller's module
    beforeEach(() => {
      module('sf.sqlQuery');
      module($exceptionHandlerProvider => $exceptionHandlerProvider.mode('log'));

      inject((SqlQueryService, $q) => {
        function dbInstance() { return $q.when(sqlInstance); }

        executeStub = sinon.stub(executeSql, 'executeSql');

        backUp = new SqlQueryService('test', dbInstance);
      });
    });

    // Initialize the controller and a mock scope
    afterEach(() => {
      executeStub.restore();
    });

    describe('Instantiate', () => {
      it('should instantiate Backup Class', inject(($timeout) => {
        var data;

        expect(backUp.backUpName).equal('test');

        backUp.backUpDB().then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(data.test).equal('test');
      }));
    });

    // ---------------
    //
    //      List
    //
    // ---------------
    describe('List', () => {
      it('should failed to list Backup datas', inject(($q, $timeout, $exceptionHandler) => {
        var data;

        executeStub.callsArgWith(3, 'test', 'fail');

        backUp.listBackUp().catch((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(data).equal('fail');
        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should list Backup datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', angular.copy(backupDatas));

        backUp.listBackUp().then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).equal('SELECT * FROM test');

        expect(data).lengthOf(2);
      }));
    });

    // ---------------
    //
    //      Get
    //
    // ---------------
    describe('Get', () => {
      it('should failed to get Backup data', inject(($q, $timeout, $exceptionHandler) => {
        executeStub.callsArgWith(3, 'test', {});
        backUp.getBackUp();

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should failed if data not find', inject(($q, $timeout, $exceptionHandler) => {
        var err;

        executeStub.yields('test', { rows: [] });

        backUp.getBackUp().catch((_err_) => {
          err = _err_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('SELECT * FROM test');
        expect(executeStub.args[0][0]).contain('WHERE id=');

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err.status).equal(404);
      }));

      it('should get Backup data', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', angular.copy(backupDatas));

        backUp.getBackUp().then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('SELECT * FROM test');
        expect(executeStub.args[0][0]).contain('WHERE id=');

        expect(data.id).equal(1);
      }));
    });

    // ---------------
    //
    //    Query
    //
    // ---------------
    describe('Query', () => {
      it('should failed to query Backup datas', inject(($q, $timeout, $exceptionHandler) => {
        executeStub.callsArgWith(3, 'test', {});
        backUp.queryBackUp();

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should query Backup datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', angular.copy(backupDatas));

        // Common param
        backUp.queryBackUp({
          test: 'test1',
          isOk: false,
        }).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).equal('SELECT * FROM test;');

        expect(data).lengthOf(1);
        expect(data[0].id).equal(1);

        // Array param
        data = null;
        backUp.queryBackUp({
          test: ['test1', 'test2'],
        }).then((_data_) => {
          data = _data_;
        });
        $timeout.flush();

        expect(data).lengthOf(2);
        expect(data[0].id).equal(1);
        expect(data[1].id).equal(2);
      }));

      it('should query Backup datas with indexed fields',
      inject(($q, $timeout, SqlQueryService) => {
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
        }).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).equal('SELECT * FROM test WHERE test=? AND test2 IN (?,?);');
        expect(executeStub.args[0][1][0]).equal('test');
        expect(executeStub.args[0][1][1]).equal('ok');
        expect(executeStub.args[0][1][2]).equal('not ok');

        expect(data).lengthOf(1);
      }));
    });

    // ---------------
    //
    //    Save
    //
    // ---------------
    describe('Save', () => {
      var dataUpdate = null;
      var data = null;

      beforeEach(() => {
        dataUpdate = { id: 1, test: 'test' };
        data = null;
      });

      it('should failed to save Backup', inject(($q, $timeout, $exceptionHandler) => {
        executeStub.callsArgWith(3, 'test', {});

        backUp.saveBackUp(1, dataUpdate).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(data).equal(null);
      }));

      it('should succeed to create or save backup', inject(($q, $timeout) => {
        executeStub.yields('test', 'ok');

        backUp.saveBackUp(1, dataUpdate).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('INSERT OR REPLACE INTO test');
        expect(executeStub.args[0][1][0]).equal(1);
        expect(executeStub.args[0][1][1]).equal(angular.toJson(dataUpdate));

        expect(data).equal(dataUpdate);
      }));
    });

    // ---------------
    //
    //    Update
    //
    // ---------------
    describe('Update', () => {
      var dataUpdate = null;
      var data = null;

      beforeEach(() => {
        dataUpdate = { id: 1, test: 'test' };
        data = null;
      });

      it('should failed to update Backup datas', inject(($q, $timeout, $exceptionHandler) => {
        executeStub.callsArgWith(3, 'test', {});

        backUp.updateBackUp(1, 'test').then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(data).equal(null);
      }));

      it('should succeed to update Backup datas', inject(($q, $timeout) => {
        executeStub.yields('test', 'ok');

        backUp.updateBackUp(dataUpdate).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('UPDATE test');
        expect(executeStub.args[0][1][1]).equal(1);

        expect(data).equal(dataUpdate);
      }));

      it('should succeed to update Backup datas with indexed fields',
      inject(($q, $timeout, SqlQueryService) => {
        function dbInstance() { return $q.when(sqlInstance); }
        backUp = new SqlQueryService('test', dbInstance, {
          indexed_fields: ['test'],
        });

        executeStub.yields('test', 'ok');

        backUp.updateBackUp(dataUpdate).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('UPDATE test SET payload=?, test=? WHERE id=?');
        expect(executeStub.args[0][1][1]).equal('test');
        expect(executeStub.args[0][1][2]).equal(1);

        expect(data).equal(dataUpdate);
      }));
    });

    // ---------------
    //
    //    Remove
    //
    // ---------------
    describe('Remove', () => {
      it('should failed to remove Backup datas', inject(($q, $timeout, $exceptionHandler) => {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.removeBackUp(1).then((_err_) => {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should succeed to remove Backup datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', 'ok');

        backUp.removeBackUp(1).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('DELETE FROM test');
        expect(executeStub.args[0][1][0]).equal(1);

        expect(data).equal('ok');
      }));
    });

    // ---------------
    //
    //    Bulk
    //
    // ---------------
    describe('Bulk', () => {
      it('should failed to bulk', inject(($q, $timeout, $exceptionHandler) => {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.bulkDocsBackUp([{ id: 1 }]).then((_err_) => {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should do nothing', inject(($q, $timeout) => {
        var data = null;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([]).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(0);
        expect(data).equal({}.undef);
      }));

      it('should delete datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([{ id: 1, _deleted: true }]).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('DELETE FROM test');
        expect(executeStub.args[0][0]).not.contain('INSERT OR REPLACE');
        expect(executeStub.args[0][1][0]).equal(1);

        expect(data).deep.equal(['ok']);
      }));

      it('should modify datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([{ id: 1 }]).then((_data_) => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).not.contain('DELETE FROM test');
        expect(executeStub.args[0][0]).contain('INSERT OR REPLACE');
        expect(executeStub.args[0][1][0]).equal(1);

        expect(data).deep.equal(['ok']);
      }));

      it('should modify and delete datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([
          { id: 1 },
          { id: 2, _deleted: true },
          { id: 3, _deleted: true },
          { id: 4 },
        ]).then((_data_) => {
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
      inject(($q, $timeout, SqlQueryService) => {
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
          { id: 3, test: {}.undef },
        ]).then((_data_) => {
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
        expect(executeStub.args[0][1][6]).equal(3);
        expect(executeStub.args[0][1][8]).equal(null);

        expect(data).deep.equal(['ok']);
      }));
    });

  });
}());
