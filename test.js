import { combineEpics, ofType, createEpicMiddleware } from 'redux-observable'
import {
  defaultTo,
  find,
  map as fmap,
  forEach,
  objOf,
  groupBy,
  head,
  ifElse,
  invoker,
  merge,
  path,
  pipe,
  prop,
  propEq,
  range,
  reduce,
  sortBy,
  values
} from 'ramda'
import { map, mergeMap, withLatestFrom } from 'rxjs/operators'
import { catchObservableError, fetch } from './Util'
import {
  deleteField,
  detailsNotUpdated,
  detailsUpdated,
  errorDeletingField,
  fieldDeleted,
  load,
  receive,
  updateDetails,
} from '../State/Form'
import { receiveSections } from '../State/FormEditor/Section'
import { applyMiddleware, createStore } from 'redux'
import {
  action,
  action1,
  action2,
  createReducer,
  init,
  when
} from 'ramduck-redux'

/**
 * StoreConfig :: {
 *  debug :: Boolean
 *  effect :: (Stream a, Stream s) -> Stream a
 *  reducer :: (Action, State) -> State
 * }
 */

// debugReducer :: ((State, Action) -> State) -> (Action, State) -> State
const debugReducer = reducer => (state, action) => {
  const newState = reducer(state, action)

  console.groupCollapsed(action.type || '')
  console.log('Action', action)
  console.log('Current State', state)
  console.log('New State', newState)
  console.groupEnd()

  return newState
}

// configureStore :: StoreConfig -> Store
export const configureStore = ({ debug, effect, reducer }) => {
  const epicMiddleware = createEpicMiddleware()
  const store = createStore(
    debug ? debugReducer(reducer) : reducer,
    applyMiddleware(epicMiddleware),
  )

  epicMiddleware.run(effect)

  return store
}

// makeRecord :: Map String (a -> b) -> a -> Map String b
export const makeRecord = mapper => subject => {
  const destination = {}

  for (const key in mapper) {
    destination[key] = mapper[key](subject)
  }

  return destination
}

// makeArray :: Array (a -> b) -> a -> Array b
export const makeArray = array => subject => {
  const destination = []

  for (const f of array) {
    destination.push(f(subject))
  }

  return destination
}

/**
 * User :: {
 *  id :: String
 *  firstname :: String
 *  lastname :: String
 * }
 *
 * State :: {
 *  loading :: Boolean
 *  isAuth :: Boolean
 *  loadingUser :: Boolean
 *  user :: User
 *  hasError :: Boolean
 * }
 */

// initialState :: State
export const initialState = {
  loading: false,
  isAuth: false,
  loadingUser: true,
  user: {},
  hasError: false,
}

// logIn :: () -> Action
export const logIn = action2('Auth : log the user in', username => password => ({ username, password }))

// grant :: () -> Action
export const grant = action('Auth: user granted')

// deny :: () -> Action
export const deny = action('Auth: user denied')

// loadUser :: () -> Action
export const loadUser = action('Auth: load the current user')

// receiveUser :: Map String -> Action
export const receiveUser = action1('Auth: received the current user', objOf('user'))

// notAuth :: () -> Action
export const notAuth = action('Auth: user not auth')

// Auth :: State -> Action -> State
export default createReducer('auth', [
  init(initialState),
  when(logIn, action => state => ({
    ...state,
    hasError: false,
    loading: true
  })),
  when(grant, action => state => ({
    ...state,
    hasError: false,
    loading: false,
    isAuth: true
  })),
  when(deny, action => state => ({
    ...state,
    hasError: true,
    loading: false,
    loadingUser: false,
    isAuth: false
  })),
  when(loadUser, action => state => ({
    ...state,
    hasError: false,
    loadingUser: true
  })),
  when(receiveUser, ({ user }) => state => ({
    ...state,
    hasError: false,
    loadingUser: false,
    isAuth: true,
    user
  })),
  when(notAuth, action => state => ({
    ...state,
    hasError: false,
    loading: false,
    loadingUser: false,
    isAuth: false
  })),
])

// deleteFieldEpic :: (Observable action, Observable state) -> Observable action
export const deleteFieldEpic = (action$, state$) => action$.pipe(
  ofType(deleteField.toString()),
  mergeMap(({ id }) => fetch(`/tempfields/${id}`, { method: "DELETE" })),
  map(
    ifElse(
      propEq('ok', true),
      fieldDeleted,
      errorDeletingField,
    ),
  ),
  catchObservableError(),
)

// loadFormEpic :: (Observable action, Observable state) -> Observable action
export const loadFormEpic = (action$, state$) => action$.pipe(
  ofType(load.toString()),
  mergeMap(({ id }) => fetch(`/forms/${id}`, {
    method: "GET",
    headers: {
      'Content-Type': 'application/json',
    },
  })),
  mergeMap(invoker(0, 'json')),
  mergeMap(form => [receive(formatForm(form)), receiveSections(formatDraggableSections(form.tempSections || []))]),
  catchObservableError(),
)

// updateFormEpic :: (Observable action, Observable state) -> Observable action
export const updateFormEpic = (action$, state$) => action$.pipe(
  ofType(updateDetails.toString()),
  withLatestFrom(state$),
  mergeMap(([{ details }, { form }]) => fetch(`/forms/${form.form.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(details),
  })),
  mergeMap(res => Promise.all([
    res.json(),
    Promise.resolve(res.ok)
  ])),
  map(([json, isOk]) =>
    isOk ? detailsUpdated() : detailsNotUpdated(json.error.message)
  ),
  catchObservableError(),
)

// formatForm :: JsonResponse -> Form
export const formatForm = raw => ({
  id: raw.id,
  label: raw.label,
  lastModified: raw.lastModified,
  name: raw.name,
  sections: formatSections(raw),
  type: raw.type,
})

// getFieldColumn :: Field -> Number
const getFieldColumn = pipe(
  prop('options'),
  find(propEq('name', 'position')),
  prop('value'),
  defaultTo({col: Infinity}),
  prop('col'),
)

// sortFields :: Section -> [Row]
const sortFields = pipe(
  prop('tempFields'),
  sortBy(getFieldColumn),
  groupBy(pipe(
    prop('options'),
    find(propEq('name', 'position')),
    prop('value'),
    defaultTo({row: Infinity}),
    prop('row'),
  )),
  values,
)

// formatSections :: [Section] -> Map String Section
export const formatSections = form => {
  let sections = {}
  forEach(section => {
    const rows = pipe(
      sortFields,
      fmap(row => {
        const size = pipe(
          head(),
          pipe(
            prop('options'),
            find(propEq('name', 'position')),
            prop('value'),
            defaultTo({size: 1}),
            prop('size'),
          ),
        )(row)

        let filledRow = Array(size).fill(null)
        forEach(pipe(
          field => filledRow[getFieldColumn(field) - 1] = field,
          pipe(
            prop('options'),
            find(propEq('name', 'position')),
            path(['value', 'row']),
          ),
          row => forEach(
            col => filledRow[col] === null && (filledRow[col] = {
              type: 'empty',
              options: [{
                name: "position",
                value: {
                  col: col+1,
                  row,
                  size
                },
              }],
            })
          )(range(0, size)),
        ))(row)

        return filledRow
      })
    )(section)

    const {tempFields, ...noTemp} = section

    sections[section.id] = {...noTemp, rows}
  }, form.tempSections || [])

  return sections
}

// formatDraggableSections :: [RawSection] -> [Section]
const formatDraggableSections = reduce(
  (sections, section) => merge(sections, {[section.id] : formatDraggableSection(section)})
)({})

// formatForm :: JsonResponse -> Section
const formatDraggableSection = raw => ({
  id: raw.id,
  name: raw.name,
  sortorder: raw.sortorder,
})

// Form :: (Observable a, Observable s) -> Observable a
export const Epic = combineEpics(
  deleteFieldEpic,
  loadFormEpic,
  updateFormEpic,
)
