import { api } from '@/api';
import { Connect } from '@/screens/Connect';
import { Editor } from '@/screens/Editor';
import { useState } from 'react';
import type { SessionInfo } from '../../shared/ipc-contract';

function App(): React.JSX.Element {
  // the open database, or none: the Connect screen shows until one is open
  const [session, setSession] = useState<SessionInfo | null>(null);
  if (session === null) return <Connect onOpened={setSession} />;
  return (
    <Editor
      session={session}
      onDisconnect={() => {
        api.connection.close().finally(() => setSession(null));
      }}
    />
  );
}

export default App;
