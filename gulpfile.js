(function() {
  'use strict';

  var gulp = require('gulp');
  var packageJSON = require('./package.json');
  var plugins = require('gulp-load-plugins')();
  var buildConfig = {
    fileName: packageJSON.name,
    src: ['./' + packageJSON.name + '.js'],
    testSrc: ['./*.spec.js'],
    dest: './',
  };

  gulp.task('compile', compileUgly);


  function compileUgly() {
    return gulp.src(buildConfig.src)
      .pipe(plugins.ngAnnotate())
      .pipe(plugins.concat(buildConfig.fileName + '.min.js'))
      .pipe(plugins.uglify())
      .pipe(gulp.dest(buildConfig.dest));
  }
}());
