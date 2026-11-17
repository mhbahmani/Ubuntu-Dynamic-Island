import { Composition } from "remotion";
import { FeatureTour } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="UbuntuIsland" component={FeatureTour}
        durationInFrames={3480} fps={60} width={1920} height={1080} />
    </>
  );
};
