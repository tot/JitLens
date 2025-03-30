import "./App.scss";

import AppLayout from "@/layouts/AppLayout/AppLayout";
import CallScreen from "./screens/CallScreen/CallScreen";
function App() {
    return (
        <AppLayout>
            <CallScreen />
        </AppLayout>
    );
}

export default App;
