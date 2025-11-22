import headerSlice from '@/features/common/headerSlice'
import modalSlice from '@/features/common/modalSlice'
import rightDrawerSlice from '@/features/common/rightDrawerSlice'
import userSlice from '@/features/common/userSlice'
import leadSlice from '@/features/leads/leadSlice'
import dataSlice from '@/features/api/extractBandApiSlice'
import { configureStore, AnyAction } from '@reduxjs/toolkit'

const initialState = {
  peaksByChannel: {},
  regionsByChannel: {},
  selectedPeakByChannel: {},
};

function dataReducer(state = initialState, action:AnyAction) {
  switch (action.type) {
    case "PEAKS_BY_CHANNEL":
      return {
        ...state,
        peaksByChannel: {
          ...state.peaksByChannel,
          [action.payload.channel]: action.payload.peaks,
        },
      };
    case "REGIONS_BY_CHANNEL":
      return {
        ...state,
        regionsByChannel: {
          ...state.regionsByChannel,
          [action.payload.channel]: action.payload.regions,
        },
      };
    case "SELECTED_PEAK_BY_CHANNEL":
      return {
        ...state,
        selectedPeakByChannel: {
          ...state.selectedPeakByChannel,
          [action.payload.channel]: action.payload.peak,
        },
      };
    default:
      return state;
  }
}

export const makeStore = () => {
  return configureStore({
    reducer: {
      header : headerSlice,
      rightDrawer : rightDrawerSlice,
      leads : leadSlice,
      modal : modalSlice,
      user : userSlice,
      data: dataSlice.reducer,
      peakData: dataReducer,
    }
  })
}

// Infer the type of makeStore
export type AppStore = ReturnType<typeof makeStore>
// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']