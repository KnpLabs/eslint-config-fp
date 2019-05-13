import { reduce } from 'ramda'

export const add = (x, y) =>
  x + y

export const data1 = [ 1, 2, 3, 4, 5, 6 ]

export const data2 = [
  3,
  4,
  5,
  6,
  7,
  34,
  13,
]

export const calculate = reduce(add, 0)

export const a = calculate(data1)

export const b = calculate(data2)

export const name = "John Doe"

export const sayHello = name => `Hello ${name}`

export const jane = { age: 12, name: "Jane Doe" }

export const charle = {
  age: 34,
  // test ?
  name: "Charles V",
}

export const printPerson = ({ age, name }) =>
  `Hello ${name}, you are ${age} years old`

export const test = name => {
  const fullName = `Coucou ${name}`

  return fullName
}
