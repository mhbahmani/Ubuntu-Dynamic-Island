import React from 'react';
import {AbsoluteFill, Easing, Img, Interactive, interpolate, Sequence, staticFile, Track, useCurrentFrame, useVideoConfig} from 'remotion';
import {Video} from '@remotion/media';
import {loadFont} from '@remotion/fonts';
import {recording} from './recording';

loadFont({family: 'Noto', url: staticFile('fonts/NotoSans-Regular.ttf'), weight: '400'});
loadFont({family: 'Noto', url: staticFile('fonts/NotoSans-Bold.ttf'), weight: '700'});

const Chapter = ({number, title, detail, tag}: {number: string; title: string; detail: string; tag: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return <div style={{position: 'absolute', left: 100, top: 330, width: 610}}>
    <Interactive.Div name="Feature category" style={{fontSize: 23, letterSpacing: 4, color: '#F1785E', marginBottom: 30,
      opacity: interpolate(frame, [0, 0.35 * fps], [0, 1], {extrapolateRight: 'clamp'})}}>{number} / {tag}</Interactive.Div>
    <Interactive.Div name="Feature title" style={{fontSize: 78, fontWeight: 700, lineHeight: 1.08, letterSpacing: -4, whiteSpace: 'pre-line', color: '#F5F2ED',
      translate: interpolate(frame, [0, 0.55 * fps], ['0px 24px', '0px 0px'], {extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)}),
      opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], {extrapolateRight: 'clamp'})}}>{title}</Interactive.Div>
    <Interactive.Div name="Feature explanation" style={{fontSize: 30, lineHeight: 1.55, color: '#A9ADB8', marginTop: 34, maxWidth: 570,
      opacity: interpolate(frame, [0.15 * fps, 0.6 * fps], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>{detail}</Interactive.Div>
  </div>;
};

const Progress = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  return <div style={{position: 'absolute', bottom: 0, left: 0, width: '100%', height: 4, background: '#262A31',
    opacity: interpolate(frame, [recording.cues.zoom, recording.cues.zoom + 60, recording.cues.return, recording.cues.return + 60], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
    <div style={{height: '100%', width: `${100 * frame / (durationInFrames - 1)}%`, background: '#F1785E'}} />
  </div>;
};

const SettingsDetail = () => {
  const frame = useCurrentFrame() + recording.chapters.settings;
  const active = [...recording.preferences].reverse().find(page => page.at <= frame)?.name ?? 'appearance';
  const descriptions: Record<string, string> = {
    appearance: 'Themes, transparency, size and motion.',
    notch: 'Move Music after Weather and Commute. The notch updates immediately.',
  };
  return <div style={{position: 'absolute', top: 700, left: 100, width: 580, color: '#A9ADB8', fontSize: 28, lineHeight: 1.5}}>
    <div style={{fontSize: 20, letterSpacing: 3, color: '#F1785E', textTransform: 'uppercase', marginBottom: 16}}>{active}</div>
    {descriptions[active]}
  </div>;
};

export const FeatureTour: React.FC = () => {
  const frame = useCurrentFrame();
  // The camera follows timestamps measured from native actions, so it stays in sync on recapture.
  const cameraFrames = [recording.cues.zoom, recording.cues.zoom + 108,
    recording.chapters.settings + 20, recording.chapters.settings + 95,
    recording.chapters.personalize, recording.chapters.personalize + 50,
    recording.cues.return, recording.cues.return + 108];
  return <AbsoluteFill style={{backgroundColor: '#111318', fontFamily: 'Noto, sans-serif', overflow: 'hidden'}}>
    <Interactive.Div name="Native camera" style={{position: 'absolute', width: 2560, height: 1440, transformOrigin: '0 0',
      scale: interpolate(frame, cameraFrames, [0.75, 1, 1, 1.35, 1.35, 1, 1, 0.75], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)}),
      translate: interpolate(frame, cameraFrames, ['0px 0px', '0px 224px', '0px 224px', '-408px -379px', '-408px -379px', '0px 224px', '0px 224px', '0px 0px'], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)})}}>
      <Video name="Native GNOME demo" src={staticFile('tour.mp4')} muted style={{width: 2560, height: 1440}} />
      <Img src={staticFile('desktop.png')} style={{position: 'absolute', inset: 0, width: 2560, height: 1440,
        opacity: interpolate(frame, [90, 120, recording.cues.return + 30, recording.cues.return + 105], [1, 0, 0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}} />
    </Interactive.Div>
    <div style={{opacity: interpolate(frame, [recording.cues.zoom, recording.cues.zoom + 100, recording.cues.return, recording.cues.return + 60], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
      <Interactive.Div name="Brand" style={{position: 'absolute', top: 78, left: 100, fontSize: 27, fontWeight: 700, letterSpacing: -0.5, color: '#F5F2ED'}}>
        <span style={{display: 'inline-block', width: 34, height: 13, borderRadius: 12, background: '#F1785E', marginRight: 18, verticalAlign: 'middle'}} />Ubuntu Island
      </Interactive.Div>
      <Interactive.Div name="Platform" style={{position: 'absolute', top: 84, right: 100, color: '#888E9A', fontSize: 19, letterSpacing: 3}}>GNOME SHELL 46 / WAYLAND</Interactive.Div>
      <Track name="Feature captions">
        <Sequence name="desktop" durationInFrames={469}>
        </Sequence>
        <Sequence name="opening" from={469} durationInFrames={138}>
          <Chapter number="01" tag="AT A GLANCE" title={'Small space.\nMore control.'} detail="Weather, commute, agents, CPU and bandwidth. Your day at a glance." />
        </Sequence>
        <Sequence name="media" from={607} durationInFrames={144}>
          <Chapter number="02" tag="MEDIA" title={'Stay in\nthe flow.'} detail="Your current track, artwork and playback controls, always within reach." />
        </Sequence>
        <Sequence name="system" from={751} durationInFrames={167}>
          <Chapter number="03" tag="SYSTEM" title={'A pulse on\nyour desktop.'} detail="CPU, memory and network activity at a glance." />
        </Sequence>
        <Sequence name="audio" from={918} durationInFrames={171}>
          <Chapter number="04" tag="SOUND" title={'The right\noutput.'} detail="Switch between speakers and headphones without leaving your flow." />
        </Sequence>
        <Sequence name="bluetooth" from={1089} durationInFrames={175}>
          <Chapter number="05" tag="BLUETOOTH" title={'Devices.\nWithin reach.'} detail="Manage connections and see supported battery levels." />
        </Sequence>
        <Sequence name="weather" from={1264} durationInFrames={211}>
          <Chapter number="06" tag="WEATHER · OPTIONAL" title={'A little\natmosphere.'} detail="Animated conditions and an hourly outlook, right here." />
        </Sequence>
        <Sequence name="commute" from={1475} durationInFrames={177}>
          <Chapter number="07" tag="COMMUTE · OPTIONAL" title={'Before\nyou head out.'} detail="Check your saved route and its estimated journey time." />
        </Sequence>
        <Sequence name="agents" from={1652} durationInFrames={197}>
          <Chapter number="08" tag="AGENTS · EXPERIMENTAL" title={'Keep work\nin sight.'} detail="Follow local coding-agent sessions and their reported status." />
        </Sequence>
        <Sequence name="notifications" from={1849} durationInFrames={182}>
          <Chapter number="09" tag="NOTIFICATIONS · OPTIONAL" title={'Catch up.\nClear the noise.'} detail="Your recent notifications, together in one place." />
        </Sequence>
        <Sequence name="calendar" from={2031} durationInFrames={310}>
          <Chapter number="10" tag="CALENDAR · OPTIONAL" title={'Every date.\nIts own story.'} detail="Change the day, see its events. Discover holidays across calendar systems." />
        </Sequence>
        <Sequence name="settings" from={2341} durationInFrames={445}>
          <Chapter number="11" tag="MAKE IT YOURS" title={'Your desktop.\nYour choices.'} detail="Choose your look. Arrange the notch to match your workflow." />
          <SettingsDetail />
          <div style={{position: 'absolute', left: 100, top: 870, width: 620, height: 65, overflow: 'hidden'}}>
            <Video name="Live notch order" src={staticFile('tour.mp4')} trimBefore={recording.chapters.settings} muted
              style={{position: 'absolute', width: 1664, height: 936, left: -522, top: 0}} />
          </div>
        </Sequence>
        <Sequence name="personalize" from={2786} durationInFrames={694}>
          <Chapter number="12" tag="LIVE PERSONALIZATION" title={'A different\nshade of you.'} detail="Seven colors. One island. Find the shade that fits your desktop." />
        </Sequence>
      </Track>
      <Interactive.Div name="Demo disclosure" style={{position: 'absolute', bottom: 65, left: 100, fontSize: 20, color: '#9299A5'}}>REAL GNOME INTERFACE <span style={{color: '#565E6A', margin: '0 16px'}}>/</span> FICTIONAL DEMO DATA</Interactive.Div>
    </div>
    <Interactive.Div name="Desktop introduction" style={{position: 'absolute', inset: 0, background: 'linear-gradient(transparent 40%, rgba(10,8,18,0.65))',
      opacity: interpolate(frame, [recording.cues.zoom - 35, recording.cues.zoom + 25, recording.cues.return + 30, recording.cues.return + 108], [1, 0, 0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
      <div style={{position: 'absolute', left: 100, bottom: 180, color: '#F5F2ED'}}>
        <div style={{fontSize: 25, letterSpacing: 5, marginBottom: 22}}>UBUNTU ISLAND</div>
        <div style={{fontSize: 84, fontWeight: 700, letterSpacing: -3}}>Right at the top.</div>
        <div style={{fontSize: 29, color: '#D7CCD7', marginTop: 20}}>A small notch. A whole desktop of possibilities.</div>
      </div>
    </Interactive.Div>
    <Progress />
  </AbsoluteFill>;
};
