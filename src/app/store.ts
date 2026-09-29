import { configureStore } from '@reduxjs/toolkit'
import { samplingApi } from './api'
import { developmentReducer } from '../features/developmentSlice'
import { offlineBatchReducer } from '../features/offlineBatch/offlineBatchSlice'

const persistedKey = 'garment-sampling-draft-v1'
const offlineBatchKey = 'garment-sampling-offline-batch-v1'

export const store = configureStore({
  reducer: {
    development: developmentReducer,
    offlineBatch: offlineBatchReducer,
    [samplingApi.reducerPath]: samplingApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(samplingApi.middleware),
})

store.subscribe(() => {
  const state = store.getState().development
  localStorage.setItem(persistedKey, JSON.stringify(state))
})

store.subscribe(() => {
  const state = store.getState().offlineBatch
  localStorage.setItem(offlineBatchKey, JSON.stringify(state))
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
