import axios from "axios";

interface DataPoint {
  x: number;
  y: number;
}

type ChannelName = "red" | "green" | "blue" | "grayscale";

type TrackChannels = {
  [channel in ChannelName]: number[];
};

interface AllTracksInput {
  [trackIndex: string]: TrackChannels;
}

export  interface PreprocessedOutput {
  [trackIndex: string]: {
    [channel in ChannelName]: number[];
  };
}


export async function preprocessAllTracksAPI(
  allTracks: AllTracksInput,
  preprocessOrder: string[],
  preprocessOption: any
): Promise<PreprocessedOutput> {
  try {
    const { data } = await axios.post(
      "http://localhost/Processed_densitogram/",
      {
        densitogram_data: allTracks,
        preprocess_order: preprocessOrder,
        preprocess_option: preprocessOption,
      }
    );
    return data.processed_data as PreprocessedOutput;
  } catch (error) {
    console.error("Error calling preprocess API", error);
    throw error;
  }
}

