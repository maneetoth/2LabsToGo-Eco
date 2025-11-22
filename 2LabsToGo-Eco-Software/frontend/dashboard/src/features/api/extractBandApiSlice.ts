// features/dataSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import axios from 'axios'

type DataState = {
  data: any
  loading: boolean
  error: string | null
}

const initialState: DataState = {
  data: null,
  loading: false,
  error: null,
}

// Send cookies and map Django's CSRF cookie/header
axios.defaults.withCredentials = true
axios.defaults.xsrfCookieName = 'csrftoken'
axios.defaults.xsrfHeaderName = 'X-CSRFToken'

// Accept FormData in the thunk
export const fetchBandData = createAsyncThunk(
  'data/fetchBandData',
  async (uploadFormData: FormData) => {
    // Ensure the CSRFTOKEN cookie is set
    try {
      await axios.get('/csrf/', { withCredentials: true })
    } catch (_) {
      // ignore if already set
    }

    // Read token from cookie and send it as header
    const csrftoken =
      document.cookie
        .split('; ')
        .find(c => c.startsWith('csrftoken='))?.split('=')[1] ?? ''

    const response = await axios.post(
      // relative URL → same-origin via Nginx
      '/Raw_densitogram/',
      uploadFormData,
      {
        withCredentials: true,
        headers: {
          'X-CSRFToken': csrftoken,
          // Let axios set the multipart boundary automatically
          // 'Content-Type': 'multipart/form-data',
        },
      }
    )
    return response.data
  }
)

const dataSlice = createSlice({
  name: 'data',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchBandData.pending, state => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchBandData.fulfilled, (state, action) => {
        state.loading = false
        state.data = action.payload
      })
      .addCase(fetchBandData.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to fetch data'
      })
  },
})

export default dataSlice
