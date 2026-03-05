![SAIT logo](https://jenstech.qzz.io/cdn/img/Sparx/SparxLogo-128x128.png)

# Sparx AI Tools

Sparx AI Tools is a Chrome extension that adds homework help tools to Sparx Reader and Sparx Science pages.

> [!WARNING]
>
> Due to the nature of the sparx science extension controlling your browser
> to automate question answering, Microsoft Defender may flag the files as
> a false positive. To solve this, allow it through defender.

## Modules

### Reader tools
#### LLM: Whatever LLM you choose!
Reader mode adds quick clipboard helpers directly into the page UI:

- **Simple design**: Just hit copy and paste into whatever LLM you prefer
- **Book copy button**: copies the current reading text into a prepared prompt format
- **Question copy button**: copies the active question + options into a prepared prompt format

### Science tools
#### LLM: Gemini by google [(?)](#why-gemini)
Science mode provides a one-click workflow around question extraction and AI response handling:

- **Solve Science button** for one-click processing
- **Stable question extraction** from Sparx question parts and tables
- **Gemini tab orchestration** (find/open, pin, submit, wait for response)
- **Structured response parsing** with guarded start/end markers
- **Floating result panel** with formatted answers (`a)`, `b)`, etc.) and copy/close actions
- **Global menu entry**: `Sparx AI Tools` in the Sparx header menu
- **Settings modal** for timeouts/retries and capture behavior
- **Auto-recovery** on transient timeouts (refresh/retry path)

![](/cdn/img/sci/Answer.png)

## Recommended LLMs

From current testing:

1. **[Gemini](https://gemini.google.com)**: highest consistency
2. **[ChatGPT](https://chatgpt.com/?temporary-chat=true)**: works, but can be less consistent in most cases

If you test another model and want it listed here, open an [issue](https://github.com/JensTech/Sparx-AI-Tools/issues/new).

## Installation

1. Download the latest release ZIP from the [Releases page](https://github.com/JensTech/Sparx-AI-Tools/releases/latest).
2. Extract the ZIP to a normal folder.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extracted folder (not the ZIP file).
6. Make sure the extension is enabled.

![Chrome extensions window](/cdn/img/Tutorial1.png)

## Quick usage

### Reader

1. Open a Reader page.
2. Use the copy buttons on book/question panels.
3. Paste into your preferred tool.

### Science

1. Open a Science question page.
2. Click **Solve Science**.
3. Use the floating response panel to review/copy the output.
4. Open **Menu -> Sparx AI Tools** to tune retries/timeouts if needed.

## Why gemini?
The extension may work with other AI models, but I have only tested it with gemini <br>
I used gemini due to the high limits on images and calculations. <br>
*If you test another model and it works well, open an [issue](https://github.com/JensTech/Sparx-AI-Tools/issues/new) and I'll add it as an official model.*

## Sparx Science Images
![](/cdn/img/sci/CustomSettings.png)
![](/cdn/img/sci/Flashcards.png)