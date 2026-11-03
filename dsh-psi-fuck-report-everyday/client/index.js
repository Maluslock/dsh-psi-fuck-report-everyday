(function () {
  var ID = 'dsh-psi-fuck-report-everyday'
  window.__ModuleLoader__.load({
    id: ID,
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
      var React = require('react')
      exports.name = ID + '-client'
      exports.inject = ['slots', 'locale', 'layout']
      function Panel() {
        return React.createElement('div', { style: { padding: 24 } }, '下班日报')
      }
      exports.apply = function (ctx) {
        ctx.slots.register(
          { name: 'main', key: ID, locale: 'zh', inject: function () { return {} } },
          Panel,
        )
      }
      return module.exports
    },
  })
})()
