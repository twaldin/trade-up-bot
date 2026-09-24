import React from "react";
import { Composition, registerRoot, staticFile, type CalculateMetadataFunction } from "remotion";
import { ScreenAd, type ScreenAdProps } from "./compositions/ScreenAd";
import { StaticAd, type StaticAdProps } from "./compositions/StaticAd";
import { buildCatalog } from "./catalog";
import { type Facts } from "./facts";
import { DIMENSIONS, FPS } from "./theme";

const load = async (): Promise<Facts> => {
  const res = await fetch(staticFile("captures/facts.json"));
  if (!res.ok) throw new Error("public/captures/facts.json missing. Run npm run capture.");
  return (await res.json()) as Facts;
};

const videoMeta: CalculateMetadataFunction<ScreenAdProps> = async ({ props }) => {
  const facts = await load();
  const job = buildCatalog(facts).videos.find((v) => v.id === props.id);
  if (!job) throw new Error(`unknown video ${props.id}`);
  return { durationInFrames: job.durationInFrames, props: job.props, width: job.width, height: job.height };
};

const stillMeta: CalculateMetadataFunction<StaticAdProps> = async ({ props }) => {
  const facts = await load();
  const job = buildCatalog(facts).stills.find((s) => s.id === props.id);
  if (!job) throw new Error(`unknown still ${props.id}`);
  return { props: job.props, width: job.width, height: job.height };
};

const emptyVideo: ScreenAdProps = {
  id: "",
  angle: "",
  format: "vertical",
  layout: "panel",
  scenes: [],
  endCard: { seconds: 3.6, headline: "", cta: "", url: "", offer: "", honesty: "" },
  footnote: "",
  takes: {},
};

const emptyStill: StaticAdProps = {
  id: "",
  angle: "",
  format: "square",
  headline: "",
  sub: "",
  visual: { type: "fees", rows: [], label: "" },
  cta: "",
  url: "",
  disclaimer: "",
  source: "",
  takes: {},
};

const VIDEO_IDS = [
  ["meta-a-float-vertical", "vertical"],
  ["meta-a-float-square", "square"],
  ["meta-a-float-landscape", "landscape"],
  ["meta-b-ugc-vertical", "vertical"],
  ["meta-c-verify-vertical", "vertical"],
] as const;

const STILL_IDS = [
  ["static-float-split-1080", "square"],
  ["static-float-number-1080", "square"],
  ["static-verify-1080", "square"],
  ["static-fees-1080", "square"],
  ["static-float-split-1350", "portrait"],
  ["static-float-number-1350", "portrait"],
  ["static-verify-1350", "portrait"],
  ["static-fees-1350", "portrait"],
] as const;

export const RemotionRoot: React.FC = () => (
  <>
    {VIDEO_IDS.map(([id, format]) => (
      <Composition
        key={id}
        id={id}
        component={ScreenAd}
        durationInFrames={FPS * 18}
        fps={FPS}
        width={DIMENSIONS[format].width}
        height={DIMENSIONS[format].height}
        defaultProps={{ ...emptyVideo, id }}
        calculateMetadata={videoMeta}
      />
    ))}
    {STILL_IDS.map(([id, format]) => (
      <Composition
        key={id}
        id={id}
        component={StaticAd}
        durationInFrames={1}
        fps={FPS}
        width={DIMENSIONS[format].width}
        height={DIMENSIONS[format].height}
        defaultProps={{ ...emptyStill, id, format }}
        calculateMetadata={stillMeta}
      />
    ))}
  </>
);

registerRoot(RemotionRoot);
