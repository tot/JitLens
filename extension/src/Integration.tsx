import { useEffect } from "react";

function Integration() {
    useEffect(() => {
        console.log("testsss");
        console.log(import.meta.env.VITE_NOTION_INTEGRATION);
    }, []);

    useEffect(() => {
        const fetch = async () => {
            const data = await document.location.href;
            console.log("current", data);
        };

        fetch();
    });
    return <div>{/* <h1>Integration</h1> */}</div>;
}

export default Integration;
