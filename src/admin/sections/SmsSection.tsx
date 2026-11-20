import { useAdmin } from '../AdminContext';
import { Group, Section, Toggle } from '../ui';

export function SmsSection() {
  const { draft, edit } = useAdmin();
  return (
    <Section title="SMS" description="Happi is played by a real person on the phone line. Typed chat can be forwarded to them by text message. (The calling number itself is set on the server.)">
      <Group title="Text message forwarding">
        <Toggle label="Send typed chat to Happi" checked={draft.smsPolicy.sendTypedChatToSms}
          onChange={(v) => edit((d) => { d.smsPolicy.sendTypedChatToSms = v; })}
          hint="What visitors type in the chat is texted to Happi's phone, so she can answer it on the call." />
        <Toggle label="Send the visitor's speech as text" checked={draft.smsPolicy.sendSpeechToSms}
          onChange={(v) => edit((d) => { d.smsPolicy.sendSpeechToSms = v; })}
          hint="Also texts the transcript of what the visitor says. Usually off: she already hears them on the call." />
      </Group>
    </Section>
  );
}
