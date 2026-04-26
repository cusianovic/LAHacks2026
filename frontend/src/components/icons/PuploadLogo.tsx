import type { SVGProps } from 'react';

// =====================================================================
// PuploadLogo — the brand mark, inlined so it can be tinted via CSS.
//
// The path is identical to `assets/pupload.svg` (the source-of-truth
// asset committed at the repo root). We inline it here for two reasons:
//
//   1. `fill="currentColor"` lets every caller pick a colour by setting
//      `text-*` on the wrapper — the corner uses `text-white`, the
//      eventual marketing/full-size mark can use `text-accent` for the
//      Pupload green, etc. No second SVG file per colour.
//   2. No <img>/asset round-trip — the mark renders inline with the
//      surrounding chrome and inherits sizing/animations cleanly.
//
// If the source SVG is ever updated, regenerate the `d=` attribute by
// copying it from the path in `assets/pupload.svg`. The viewBox stays
// fixed unless the canvas changes.
// =====================================================================

type PuploadLogoProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'fill' | 'children'>;

export default function PuploadLogo(props: PuploadLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 93.461571 81.282318"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M 37.092409,-1.2476698e-6 C -2.1014792,-1.2476698e-6 0.02025378,9.9332425 0.02025378,9.9332425 c 0,0 23.18808822,57.9530095 28.80599422,65.4435535 5.617908,7.490537 35.042721,3.143708 41.606761,4.902543 6.564033,1.75882 5.882328,-5.61103 5.882328,-5.61103 0,0 2.478312,-1.470298 4.357358,-1.348236 0.992634,0.06446 -2.677389,7.483085 -1.358056,7.950935 0.799229,0.283416 4.692666,-4.854189 6.114356,-4.886524 2.343443,-0.05332 -1.154966,4.699452 -1.154966,4.699452 0,0 9.187552,-5.078751 9.187552,-20.179129 0,-15.100379 -11.249962,-19.485115 -11.249962,-19.485115 a 4.7690348,4.7690348 0 0 0 0.701765,-2.490807 4.7690348,4.7690348 0 0 0 -4.768701,-4.769212 4.7690348,4.7690348 0 0 0 -2.416906,0.657837 C 74.523246,24.810292 68.381952,-1.2476698e-6 37.092409,-1.2476698e-6 Z M 61.203081,26.777173 a 4.3965845,4.3965845 0 0 1 4.396635,4.396635 4.3965845,4.3965845 0 0 1 -4.396635,4.396628 4.3965845,4.3965845 0 0 1 -4.396628,-4.396628 4.3965845,4.3965845 0 0 1 4.396628,-4.396635 z" />
    </svg>
  );
}
