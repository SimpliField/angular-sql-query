(function iife() {
  'use strict';

  describe('SqlQueryService', () => {
    let SqlQueryService = null;
    var backUp;
    var executeStub;
    var executeSql = { executeSql: () => {} };
    var sqlInstance = {
      test: 'test',
      transaction: (cb, errCb, resCb) => {
        if (resCb) {
          resCb();
        }
        return cb(executeSql);
      },
    };
    let datas = null;
    let backupDatas = null;

    // load the controller's module
    beforeEach(() => {
      datas = [
        {
          id: 1,
          test: 'test1',
          isOk: 0,
          tag: 'item',
          params: [{ k: 'b', v: 2 }],
        },
        {
          id: 2,
          test: 'test2',
          isOk: 1,
          tag: 'item',
          nested: {
            k: 'a',
            v: 1,
          },
        },
      ].map(data => angular.toJson(data));
      backupDatas = {
        rows: {
          item: i => ({ payload: datas[i] }),
          length: datas.length,
        },
      };

      module('sf.sqlQuery');
      module($exceptionHandlerProvider =>
        $exceptionHandlerProvider.mode('log')
      );

      inject((_SqlQueryService_, $q) => {
        SqlQueryService = _SqlQueryService_;
        function dbInstance() {
          return $q.when(sqlInstance);
        }

        executeStub = sinon.stub(executeSql, 'executeSql');

        backUp = new SqlQueryService('test', dbInstance);
      });
    });

    // Initialize the controller and a mock scope
    afterEach(() => {
      executeStub.restore();
    });

    describe('Instantiate', () => {
      it('should instantiate Backup Class', inject($timeout => {
        var data;

        expect(backUp.backUpName).equal('test');

        backUp.backUpDB().then(_data_ => {
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
    describe('#listBackUp()', () => {
      it('should failed to list Backup datas', inject((
        $q,
        $timeout,
        $exceptionHandler
      ) => {
        var data;

        executeStub.callsArgWith(3, 'test', 'fail');

        backUp.listBackUp().catch(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect(data).equal('fail');
        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should list Backup datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', backupDatas);

        backUp.listBackUp({ limit: 10, offset: 10 }).then(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).equal(
          'SELECT * FROM test LIMIT 10 OFFSET 10'
        );

        expect(data).lengthOf(2);
      }));
    });

    // ---------------
    //
    //      Get
    //
    // ---------------
    describe('#getBackUp()', () => {
      it('should failed to get Backup data', inject((
        $q,
        $timeout,
        $exceptionHandler
      ) => {
        executeStub.callsArgWith(3, 'test', {});
        backUp.getBackUp(1);

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
      }));

      it('should failed if data not find', inject((
        $q,
        $timeout,
        $exceptionHandler
      ) => {
        var err;

        executeStub.yields('test', { rows: [] });

        backUp.getBackUp('ABC').catch(_err_ => {
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

        executeStub.yields('test', backupDatas);

        backUp.getBackUp(1).then(_data_ => {
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
    describe('#queryBackUp()', () => {
      describe('without datas', () => {
        it('should fail to query Backup datas', inject((
          $timeout,
          $exceptionHandler
        ) => {
          executeStub.callsArgWith(3, 'test', {});
          backUp.queryBackUp();

          $timeout.flush();

          expect($exceptionHandler.errors).lengthOf(1);
        }));
      });

      describe('with indexed fields', () => {
        it('should query Backup datas', inject($timeout => {
          var data;

          executeStub.yields('test', backupDatas);

          // Common param
          backUp
            .queryBackUp(
              {
                test: 'test1',
              },
              { limit: 10 }
            )
            .then(_data_ => {
              data = _data_;
            });

          $timeout.flush();

          expect(executeStub.callCount).equal(1);
          expect(executeStub.args[0][0]).equal('SELECT * FROM test LIMIT 10;');

          expect(data).lengthOf(1);
          expect(data[0].id).equal(1);

          // Array param
          data = null;
          backUp
            .queryBackUp({
              test: ['test1', 'test2'],
            })
            .then(_data_ => {
              data = _data_;
            });
          $timeout.flush();

          expect(data).lengthOf(2);
          expect(data[0].id).equal(1);
          expect(data[1].id).equal(2);
        }));

        it('should query Backup datas with sort', inject($timeout => {
          var data;

          executeStub.yields('test', backupDatas);

          // Common param
          backUp
            .queryBackUp(
              {
                test: 'test1',
                isOk: false,
              },
              { limit: 10 },
              [{ key: 'name', desc: true }]
            )
            .then(_data_ => {
              data = _data_;
            });

          $timeout.flush();

          expect(executeStub.callCount).equal(1);
          expect(executeStub.args[0][0]).equal(
            'SELECT * FROM test ORDER BY name DESC LIMIT 10;'
          );

          expect(data).lengthOf(1);
          expect(data[0].id).equal(1);
        }));

        it('should query Backup datas with sort desc', inject($timeout => {
          executeStub.yields('test', backupDatas);

          // Common param
          backUp
            .queryBackUp(
              {
                test: 'test1',
                isOk: false,
              },
              { limit: 10 },
              [{ key: 'name' }]
            )
            .then(_data_ => {});
          $timeout.flush();

          expect(executeStub.args[0][0]).equal(
            'SELECT * FROM test ORDER BY name LIMIT 10;'
          );
        }));

        it('should query Backup datas with multiple sort keys', inject($timeout => {
          executeStub.yields('test', backupDatas);

          // With 2 sort keys
          backUp.queryBackUp(
            {
              test: 'test1',
              isOk: false,
            },
            { limit: 10 },
            [{ key: 'name' }, { key: 'distance' }]
          );
          $timeout.flush();

          expect(executeStub.args[0][0]).equal(
            'SELECT * FROM test ORDER BY name,distance LIMIT 10;'
          );
        }));

        it('should query Backup with a large number of datas', inject((
          $q,
          $timeout
        ) => {
          function testInsertReqParams(indexReq, nbStart, nbToTest) {
            const args = executeStub.args[indexReq];

            expect(args[1].length).equal(nbToTest);
            expect(args[1][0]).equal(nbStart + 1);
            expect(args[1][nbToTest - 1]).equal(nbStart + nbToTest);
          }

          const params = [];
          const params2 = [];
          let args = null;

          function dbInstance() {
            return $q.when(sqlInstance);
          }
          backUp = new SqlQueryService('test', dbInstance, {
            indexed_fields: ['test', 'test2', 'test3'],
          });

          executeStub.returns($q.when(backupDatas));

          for (let i = 0; 1010 > i; i++) {
            params.push(i + 1);
            params2.push(1000 + i + 1);
          }

          backUp.queryBackUp({
            test: params,
            test2: params2,
            test3: [10],
          });

          $timeout.flush();

          args = executeStub.args;
          expect(executeStub.callCount).equal(13);
          expect(args[0][0]).equal('DROP TABLE IF EXISTS tmp_test_test');
          expect(args[1][0]).equal(
            'CREATE TABLE IF NOT EXISTS tmp_test_test (value TEXT)'
          );
          expect(args[2][0]).contain(
            'INSERT INTO tmp_test_test SELECT ? as value UNION ALL SELECT ?'
          );
          testInsertReqParams(2, 0, 300);
          testInsertReqParams(3, 300, 300);
          testInsertReqParams(4, 600, 300);
          testInsertReqParams(5, 900, 110);
          expect(args[6][0]).equal('DROP TABLE IF EXISTS tmp_test_test2');
          expect(args[7][0]).equal(
            'CREATE TABLE IF NOT EXISTS tmp_test_test2 (value TEXT)'
          );
          expect(args[8][0]).contain(
            'INSERT INTO tmp_test_test2 SELECT ? as value UNION ALL SELECT ?'
          );
          testInsertReqParams(8, 1000, 300);
          testInsertReqParams(9, 1300, 300);
          testInsertReqParams(10, 1600, 300);
          testInsertReqParams(11, 1900, 110);
          expect(args[12][0]).contain(
            'SELECT * FROM test WHERE test3 IN (?) AND test IN (SELECT value FROM tmp_test_test) AND test2 IN (SELECT value FROM tmp_test_test2);'
          );
        }));
      });

      describe('with non-indexed fields', () => {
        it('should query Backup datas', inject($timeout => {
          var data;

          executeStub.yields('test', backupDatas);

          // Common param
          backUp
            .queryBackUp(
              {
                nested: { k: 'a', v: 1 },
              },
              { limit: 10 }
            )
            .then(_data_ => {
              data = _data_;
            });

          $timeout.flush();

          expect(executeStub.callCount).equal(1);
          expect(executeStub.args[0][0]).equal('SELECT * FROM test LIMIT 10;');

          expect(data).lengthOf(1);
          expect(data[0].id).equal(2);
        }));
      });
      describe('with mixed fields', () => {
        it('should query Backup datas', inject(($q, $timeout) => {
          var data;

          function dbInstance() {
            return $q.when(sqlInstance);
          }
          backUp = new SqlQueryService('test', dbInstance, {
            indexed_fields: ['test', 'test2'],
          });

          executeStub.yields('test', backupDatas);

          backUp
            .queryBackUp({
              test: 'test',
              isOk: true,
              test2: ['ok', 'not ok'],
            })
            .then(_data_ => {
              data = _data_;
            });

          $timeout.flush();

          expect(executeStub.callCount).equal(1);
          expect(executeStub.args[0][0]).equal(
            'SELECT * FROM test WHERE test=? AND test2 IN (?,?);'
          );
          expect(executeStub.args[0][1]).deep.equal(['test', 'ok', 'not ok']);

          expect(data).lengthOf(1);
        }));
      });
    });

    // ---------------
    //
    //    Save
    //
    // ---------------
    describe('#saveBackUp()', () => {
      var dataUpdate = null;
      var data = null;

      beforeEach(() => {
        dataUpdate = { id: 1, test: 'test' };
        data = null;
      });

      it('should failed to save Backup', inject((
        $q,
        $timeout,
        $exceptionHandler
      ) => {
        executeStub.callsArgWith(3, 'test', {});

        backUp.saveBackUp(1, dataUpdate).then(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(data).equal(null);
      }));

      it('should succeed to create or save backup', inject(($q, $timeout) => {
        executeStub.yields('test', 'ok');

        backUp.saveBackUp(1, dataUpdate).then(_data_ => {
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
    describe('#updateBackUp()', () => {
      var dataUpdate = null;
      var data = null;

      beforeEach(() => {
        dataUpdate = { id: 1, test: 'test' };
        data = null;
      });

      it('should failed to update Backup datas', inject((
        $q,
        $timeout,
        $exceptionHandler
      ) => {
        executeStub.callsArgWith(3, 'test', {});

        backUp.updateBackUp(1, 'test').then(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(data).equal(null);
      }));

      it('should succeed to update Backup datas', inject(($q, $timeout) => {
        executeStub.yields('test', 'ok');

        backUp.updateBackUp(dataUpdate).then(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('UPDATE test');
        expect(executeStub.args[0][1][1]).equal(1);

        expect(data).equal(dataUpdate);
      }));

      it('should succeed to update Backup datas with indexed fields', inject((
        $q,
        $timeout
      ) => {
        function dbInstance() {
          return $q.when(sqlInstance);
        }
        backUp = new SqlQueryService('test', dbInstance, {
          indexed_fields: ['test'],
        });

        executeStub.yields('test', 'ok');

        backUp.updateBackUp(dataUpdate).then(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain(
          'UPDATE test SET payload=?, test=? WHERE id=?'
        );
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
    describe('#removeBackUp()', () => {
      it('should failed to remove Backup datas', inject((
        $q,
        $timeout,
        $exceptionHandler
      ) => {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.removeBackUp(1).then(_err_ => {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should succeed to remove Backup datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', 'ok');

        backUp.removeBackUp(1).then(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain('DELETE FROM test');
        expect(executeStub.args[0][1][0]).equal(1);

        expect(data).equal('ok');
      }));
    });

    describe('#removeQueryBackUp()', () => {
      it('should failed to remove Backup datas', inject((
        $q,
        $timeout,
        $exceptionHandler
      ) => {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp
          .removeQueryBackUp({
            entity_id: 10,
          })
          .then(_err_ => {
            err = _err_;
          });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should succeed to remove Backup datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', 'ok');

        backUp
          .removeQueryBackUp({
            entity_id: 10,
          })
          .then(_data_ => {
            data = _data_;
          });

        $timeout.flush();

        expect(executeStub.callCount).equal(1);
        expect(executeStub.args[0][0]).contain(
          'DELETE FROM test WHERE entity_id=?'
        );
        expect(executeStub.args[0][1]).deep.equal([10]);

        expect(data).equal('ok');
      }));
    });

    // ---------------
    //
    //    Bulk
    //
    // ---------------
    describe('#bulkDocsBackUp()', () => {
      it('should failed to bulk', inject(($q, $timeout, $exceptionHandler) => {
        var err = null;

        executeStub.callsArgWith(3, 'test', {});

        backUp.bulkDocsBackUp([{ id: 1 }]).then(_err_ => {
          err = _err_;
        });

        $timeout.flush();

        expect($exceptionHandler.errors).lengthOf(1);
        expect(err).equal(null);
      }));

      it('should do nothing', inject(($q, $timeout) => {
        var data = null;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([]).then(_data_ => {
          data = _data_;
        });

        $timeout.flush();

        expect(executeStub.callCount).equal(0);
        expect(data).equal({}.undef);
      }));

      it('should delete datas', inject(($q, $timeout) => {
        var data;

        executeStub.yields('test', 'ok');

        backUp.bulkDocsBackUp([{ id: 1, _deleted: true }]).then(_data_ => {
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

        backUp.bulkDocsBackUp([{ id: 1 }]).then(_data_ => {
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

        backUp
          .bulkDocsBackUp([
            { id: 1 },
            { id: 2, _deleted: true },
            { id: 3, _deleted: true },
            { id: 4 },
          ])
          .then(_data_ => {
            data = _data_;
          });

        $timeout.flush();

        expect(executeStub.callCount).equal(2);
        expect(executeStub.args[0][0]).contain('DELETE FROM test');
        expect(executeStub.args[0][1][0]).equal(2);
        expect(executeStub.args[0][1][1]).equal(3);
        expect(executeStub.args[1][0]).contain('INSERT OR REPLACE');
        expect(executeStub.args[1][0]).contain(
          'SELECT ? as id, ? as payload UNION ALL SELECT ?,?'
        );
        expect(executeStub.args[1][1][0]).equal(1);
        expect(executeStub.args[1][1][2]).equal(4);

        expect(data).deep.equal(['ok', 'ok']);
      }));

      it('should modify and delete datas whith indexed fields', inject((
        $q,
        $timeout
      ) => {
        var queryFields =
          'SELECT ? as id, ? as payload, ? as test UNION ALL SELECT ?,?,?';
        var data;

        function dbInstance() {
          return $q.when(sqlInstance);
        }
        backUp = new SqlQueryService('test', dbInstance, {
          indexed_fields: ['test'],
        });

        executeStub.yields('test', 'ok');

        backUp
          .bulkDocsBackUp([
            { id: 1, test: 1 },
            { id: 4, test: 2 },
            { id: 3, test: {}.undef },
          ])
          .then(_data_ => {
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
})();
