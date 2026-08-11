import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GraphWorkbench } from "../app/components/GraphWorkbench";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GraphWorkbench />
  </StrictMode>,
);
