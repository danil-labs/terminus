import { render } from "solid-js/web";
import Screen from "../../../src/features/screen/Screen";
import "../../../src/styles/global.css";
import "../../../src/locales/catalogs";
const port = new URLSearchParams(location.search).get("relay");
const mode = new URLSearchParams(location.search).get("mode") || "control";
render(() => <Screen open={() => Promise.resolve(new WebSocket(`ws://127.0.0.1:${port}/viewer/${mode}`))} />, document.getElementById("root")!);
