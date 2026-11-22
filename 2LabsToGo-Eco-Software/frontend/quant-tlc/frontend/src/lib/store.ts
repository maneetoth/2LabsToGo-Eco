import { configureStore } from "@reduxjs/toolkit";
import dataSlice from "@/features/api/extractBandApiSlice";

export const makeStore = () => configureStore({ reducer: { data: dataSlice.reducer } });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
