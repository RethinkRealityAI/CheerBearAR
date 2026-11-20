import { useAdmin } from '../AdminContext';
import { Group, Section, Toggle } from '../ui';

export function PrivacySection() {
  const { draft, edit } = useAdmin();
  return (
    <Section title="Privacy" description="Happi's voice is always transcribed so her words can trigger the scene. These settings cover the visitor's side.">
      <Group>
        <Toggle
          label="Transcribe the visitor's voice"
          checked={draft.allowUserAudioToOpenAI}
          onChange={(v) => edit((d) => { d.allowUserAudioToOpenAI = v; })}
          hint={draft.allowUserAudioToOpenAI
            ? 'On: the visitor\'s microphone audio is sent to OpenAI for transcription, so their words can show on screen and trigger reactions.'
            : 'Off (safest, recommended for children): the visitor\'s voice is never sent to OpenAI. Only Happi\'s side is transcribed.'}
        />
        <Toggle
          label="English-only transcripts"
          checked={draft.englishOnlyTranscripts}
          onChange={(v) => edit((d) => { d.englishOnlyTranscripts = v; })}
          hint="Removes characters from other alphabets that the transcriber sometimes invents from background noise."
        />
      </Group>
    </Section>
  );
}
