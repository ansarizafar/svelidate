const makeValidator = require('indicative/builds/validator')
const {
  Vanilla
} = require('indicative/builds/formatters')
const {
  writable
} = require('svelte/store')
const {
  afterUpdate,
  tick
} = require('svelte')
//export * from 'indicative/builds/validations'
const {
  email,
  required
} = require('indicative/builds/validations')

module.exports = function validator() {
  const validatorInstance = makeValidator({
    email,
    required
  }, Vanilla)

  return function (data) {
    let schema = {}
    let messages = {}
    let errStore = writable();
    let result = {}

    Object.keys(data).forEach((prop) => {
      result[prop] = {
        isValid: true,
        message: null
      }

    })

    errStore.set(result)

    let methods = {
      schema: function (rules) {
        schema = rules
        return this;
      },
      messages: function (msgTemplates) {
        messages = msgTemplates
        return this;
      },
      test: function () {
        let value = {}

        afterUpdate(async () => {

          if (!objCompare(data, value)) {

            try {
              await validatorInstance.validateAll(data, schema, messages)
              Object.keys(data).forEach((prop) => {

                result[prop] = {
                  isValid: true,
                  message: null
                }
              })

              errStore.set(result)

            } catch (errors) {

              Object.keys(data).forEach((prop) => {
                let error = errors.find((err) => err.field === prop)
                if (error) {
                  result[prop] = {
                    isValid: false,
                    message: error.message
                  }
                } else {
                  result[prop] = {
                    isValid: true,
                    message: null
                  }
                }
              })

            }
            console.log(result)
            
            errStore.set(result)

          }
          value = deepCopy(data)

        })

        return errStore

      }
    }

    return methods

  }

}

function isEmpty(obj) {
  for (var key in obj) {
    if (obj.hasOwnProperty(key))
      return false;
  }
  return true;
}

function objCompare(obj1, obj2) {
  //Loop through properties in object 1
  for (var p in obj1) {
    //Check property exists on both objects
    if (obj1.hasOwnProperty(p) !== obj2.hasOwnProperty(p)) return false;

    switch (typeof (obj1[p])) {
      //Deep compare objects
      case 'object':
        if (!Object.compare(obj1[p], obj2[p])) return false;
        break;
        //Compare function code
      case 'function':
        if (typeof (obj2[p]) == 'undefined' || (p != 'compare' && obj1[p].toString() != obj2[p].toString())) return false;
        break;
        //Compare values
      default:
        if (obj1[p] != obj2[p]) return false;
    }
  }

  //Check object 2 for any extra properties
  for (var p in obj2) {
    if (typeof (obj1[p]) == 'undefined') return false;
  }
  return true;
};

function deepCopy(oldObj) {
  var newObj = oldObj;
  if (oldObj && typeof oldObj === 'object') {
    newObj = Object.prototype.toString.call(oldObj) === "[object Array]" ? [] : {};
    for (var i in oldObj) {
      newObj[i] = deepCopy(oldObj[i]);
    }
  }
  return newObj;
}
