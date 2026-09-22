import { useEffect, useState } from "react";
import ChatWindow from "./components/ChatWindow.jsx";
import TeacherPicker from "./components/TeacherPicker.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";

/**
 * Two views, switched on the URL hash so no router dependency is needed:
 * the public chat, and #admin for the review console.
 */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return hash;
}

export default function App() {
  const hash = useHashRoute();
  const [teacher, setTeacher] = useState(null);

  if (hash === "#admin") {
    return (
      <div className="app-shell app-shell--wide">
        <AdminPanel />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {teacher ? (
        <ChatWindow teacher={teacher} onChangeTeacher={() => setTeacher(null)} />
      ) : (
        <TeacherPicker onSelect={setTeacher} />
      )}
    </div>
  );
}
