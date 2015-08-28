angular-sql-query
=====================
Make simple query on a SQLite database

[![NPM version][npm-image]][npm-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]
[![Dependency Status][david-image]][david-url]
[![License][license-image]][license-url]
[![Downloads][downloads-image]][downloads-url]


##Get Started
```bash
bower install angular-sql-query --save
```
Include `angular-sql-query.js` (or `angular-sql-query.min.js`) from the [dist](https://github.com/SimpliField/angular-sql-query/blob/master/angular-sql-query.js) directory in your `index.html`, after including Angular itself.

Add `'sf.sqlQuery'` to your main module's list of dependencies.

When you're done, your setup should look similar to the following:

```html
<!doctype html>
<html ng-app="myApp">
<head>
   
</head>
<body>
    ...
    <script src="//ajax.googleapis.com/ajax/libs/angularjs/1.1.5/angular.min.js"></script>
    <script src="bower_components/angular-sql-query/angular-sql-query.min.js"></script>
    ...
    <script>
        var myApp = angular.module('myApp', ['sf.sqlQuery']);

    </script>
    ...
</body>
</html>
```
##Configuration
For use this module, you're database need to architectured whith this field:
- `id`: Unique key for data.
- `payload`: Object data stringify with angular.toJson.

You can helped by [angular-sql-storage](https://github.com/SimpliField/angular-sql-storage) module.

**Example**

```js
var user = new sqlStorageService(name, database, options);
```

**Params**
- `name` [String] - Table name
- `database` [Promise] - Promise that return SQL database instance.
- `options` [Object] - Query options
  - `indexed_fields` [Array] - Fields referenced in database.
```js
var databaseInstance = $window.openDatabase('test', '1', 'database', 200000);
var user = new sqlStorageService('user', $q.when(databaseInstance), {
  indexed_fields: ['name'],
});
```

##API Documentation
##getBackUp
Get data by his id

**Params**
- `id`: Data id

**Returns:** `payload`

```js
user.getBackUp(1);
```

##listBackUp
All table datas

**Returns:** [Array] `payload`

```js
user.listBackUp();
```

##queryBackUp
All datas correspond to query.<br/>
If field is referenced in options, query can be set directly in SQl Query. Also, a javascript filter is used.<br/>
You need to pass an object; the key is the field name and the value is the query value.<br/>
You can pass an **Array** for make a `IN` query or a **Boolean** for a 1 or 0 query.

**Params:**
- `params`: [Object] Filter datas

**Returns:** [Array] `payload`

```js
user.queryBackUp({
  name: ['Jean', 'Paul'],
  connected: true
});
```

##saveBackUp
Save new object data

**Params:**
- `id`: Data key
- `datas`: Data object

**Returns:** `SQL save result`

```js
user.queryBackUp(1, { name: 'Jean', connected: false });
```

##updateBackUp
Update database object

**Params:**
- `data`: Object datas (with id).

**Returns:** `SQL update result`

```js
user.updateBackUp({ id: 1, name: 'Paul', connected: false });
```

##removeBackUp
Remove database object

**Params:**
- `id`: Object key.

**Returns:** `SQL remove result`

```js
user.removeBackUp(1);
```

##bulkDocsBackUp
Modify mutliple datas<br/>
It's possible to update or remove datas with one method called.<br/>
You can delete a data by set a object key `_delete` to true.

**Params:**
- `datas`: Array of object to update.

**Returns:** `SQL update result`

```js
user.bulkDocsBackUp([{
  id: 1, name: 'Jean', connected: true,
  id: 2, name: 'Paul', connected: false, _deleted: true
}]);
```

##execute
Directly make an SQL query.

**Params:**
- `query`: SQL query.
- `datas`: SQL params.

**Returns:** `SQL result`

```js
user.execute('SELECT * FROM user WHERE id=?', [1]);
```


[npm-image]: https://img.shields.io/npm/v/angular-sql-query.svg?style=flat-square
[npm-url]: https://npmjs.org/package/angular-sql-query
[travis-image]: https://img.shields.io/travis/SimpliField/angular-sql-query.svg?style=flat-square
[travis-url]: https://travis-ci.org/SimpliField/angular-sql-query
[coveralls-image]: https://img.shields.io/coveralls/SimpliField/angular-sql-query.svg?style=flat-square
[coveralls-url]: https://coveralls.io/r/SimpliField/angular-sql-query
[david-image]: http://img.shields.io/david/SimpliField/angular-sql-query.svg?style=flat-square
[david-url]: https://david-dm.org/SimpliField/angular-sql-query
[license-image]: http://img.shields.io/npm/l/angular-sql-query.svg?style=flat-square
[license-url]: LICENSE
[downloads-image]: http://img.shields.io/npm/dm/angular-sql-query.svg?style=flat-square
[downloads-url]: https://npmjs.org/package/angular-sql-query
