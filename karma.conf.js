(function() {
  'use strict';

  module.exports = function(config) {
    config.set({

      // base path that will be used to resolve all patterns (eg. files, exclude)
      basePath: './',

      // test results reporter to use
      // possible values: 'dots', 'progress'
      // available reporters: https://npmjs.org/browse/keyword/karma-reporter
      reporters: ['mocha', 'coverage'],

      // frameworks to use
      // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
      frameworks: ['mocha', 'sinon-chai'],

      // list of files / patterns to load in the browser
      files: [
        'bower_components/angular/angular.js',
        'bower_components/angular-mocks/angular-mocks.js',
        'bower_components/angular-sql-storage/angular-sql-storage.js',
        'bower_components/angular-local-storage/dist/angular-local-storage.js',
        'angular-sql-query.js',
        '*.spec.js',
      ],

      // preprocess matching files before serving them to the browser
      // available preprocessors: https://npmjs.org/browse/keyword/karma-preprocessor
      preprocessors: {
        'angular-sql-query.js': ['coverage'],
      },

      coverageReporter: {
        dir: 'coverage/',
        reporters: [
          // reporters not supporting the `file` property
          { type: 'html', subdir: 'report-html' },
          { type: 'lcov', subdir: 'report-lcov' },
        ],
      },

      // web server port
      port: 9876,

      // enable / disable colors in the output (reporters and logs)
      colors: true,

      // level of logging
      // possible values:
      // - LOG_DISABLE
      // - LOG_ERROR
      // - LOG_WARN
      // - LOG_INFO
      // - LOG_DEBUG
      logLevel: config.LOG_INFO,

      // enable / disable watching file and executing tests whenever any file changes
      autoWatch: true,

      // start these browsers
      // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
      // - PhantomJS
      // - ChromeCanary
      // - Chrome
      browsers: ['PhantomJS'],

      // Continuous Integration mode
      // if true, Karma captures browsers, runs the tests and exits
      singleRun: true,
    });
  };
}());
