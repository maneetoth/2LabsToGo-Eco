/* eslint-disable @next/next/no-img-element */
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { hrfTicks } from "@/utils/quantTlcIntegration";

interface Props {
  plate: string;
  track: string;
  trackNumber: number;
  totalTracks: number;
  onTrackChange: (track: number) => void;
}

export default function QuantTLCImages({ plate, track, trackNumber, totalTracks, onTrackChange }: Props) {
  return (
    <div className="mx-auto mb-6 w-full max-w-2xl space-y-4">
      {plate && (
        <figure className="flex items-stretch gap-2">
          <div className="relative my-px w-12 shrink-0 border-r border-current text-xs" aria-hidden="true">
            {hrfTicks.map(tick => (
              <span key={tick} className="absolute right-0 flex -translate-y-1/2 items-center gap-1"
                style={{ top: `${100 - tick}%` }}>
                {tick}<span className="w-1 border-t border-current" />
              </span>
            ))}
            <span className="absolute left-0 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl]">hRF</span>
          </div>
          <img src={plate} alt="Cropped HPTLC plate, hRF 0 at the bottom and 100 at the top"
            className="min-w-0 flex-1 rounded-lg shadow" />
        </figure>
      )}
      {track && (
        <div className="space-y-2">
          <p className="text-center text-sm">Track {trackNumber} of {totalTracks}</p>
          <div className="flex items-center justify-center gap-3">
            <button type="button" className="btn btn-circle btn-sm" aria-label="Previous track"
              disabled={trackNumber <= 1} onClick={() => onTrackChange(trackNumber - 1)}>
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <figure className="min-w-0 w-full max-w-lg">
              <div className="pb-4 text-center text-xs" aria-hidden="true">
                hRF
                <div className="relative mt-1 border-t border-current">
                  {hrfTicks.map(tick => (
                    <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${tick}%` }}>
                      <span className="mx-auto block h-1 w-px bg-current" />{tick}
                    </span>
                  ))}
                </div>
              </div>
              <img src={track} alt={`Track ${trackNumber}, hRF 0 at the left and 100 at the right`}
                className="w-full rounded-lg shadow" />
            </figure>
            <button type="button" className="btn btn-circle btn-sm" aria-label="Next track"
              disabled={trackNumber >= totalTracks} onClick={() => onTrackChange(trackNumber + 1)}>
              <ArrowRightIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
