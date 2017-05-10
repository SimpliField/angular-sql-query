var gulp = require('gulp');
var packageJSON = require('./package.json');
var plugins = require('gulp-load-plugins')();

(function iife() {
  'use strict';

  var buildConfig = {
    fileName: packageJSON.name,
    src: ['./src/!(*.spec).js'],
    dest: './',
  };

  gulp.task('compile-ugly', compileUgly);
  gulp.task('compile-file', compile);
  gulp.task('compile', [
    'compile-ugly',
    'compile-file',
  ]);

  function compile() {
    return gulp.src(buildConfig.src)
      .pipe(plugins.eslint())
      .pipe(plugins.eslint.format())
      .pipe(plugins.babel({
        presets: ['es2015'],
        plugins: ['transform-object-assign'],
      }))
      .pipe(plugins.ngAnnotate())
      .pipe(plugins.concat(buildConfig.fileName + '.js'))
      .pipe(gulp.dest(buildConfig.dest));
  }

  function compileUgly() {
    return gulp.src(buildConfig.src)
      .pipe(plugins.babel({
        presets: ['es2015'],
        plugins: ['transform-object-assign'],
      }))
      .pipe(plugins.ngAnnotate())
      .pipe(plugins.uglify())
      .pipe(plugins.concat(buildConfig.fileName + '.min.js'))
      .pipe(gulp.dest(buildConfig.dest));
  }

}());
