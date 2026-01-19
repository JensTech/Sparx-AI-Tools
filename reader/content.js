// Sparx reader extension
// This file does stuff (check README.md, i dont feel like writing more)

function loadStylesheet() {
  if (document.getElementById('SAI-css')) return;

  const link = document.createElement('link');
  link.id = 'SAI-css';
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/cdn/css/ext.css';
  document.head.appendChild(link);
}

loadStylesheet();

if (window.location.hostname.endsWith('sparx-learning.com')) { // idk how you'd manage unless you modify the manifest anyway

  // adding the clipboard to the main book happens here
  function addBookClipboard() {
    const bookContainer = document.querySelector('#book-scroll');
    if (!bookContainer || bookContainer.querySelector('.book-copy-btn-book')) return; // don't add to none existent book or a dupe

    const btn = document.createElement('button');
    btn.className = 'book-copy-btn-book';
    btn.title = 'Copy book text';

    const icon = document.createElement('img');
    icon.src = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/cdn/img/clip.svg'; // dirty way to get an svg :/
    icon.alt = '';
    icon.draggable = false;
    icon.width = 18;
    icon.height = 18;

    btn.appendChild(icon);


    btn.addEventListener('click', () => {
      const readContent = bookContainer.querySelector('.read-content');
      if (!readContent) return;

      const text = readContent.innerText.replace(/\s+\n/g, '\n').trim();
      const finalText =
        `This is the latest text for my homework, Read it, and DO NOT print any answers,
            there is nothing to answer at this point, acknowlege the text and say nothing more then "Text recieved.
            I will wait for the options"\n\n\n${text}`; // prompt, you can modify this as you like

      navigator.clipboard.writeText(finalText)
        .then(() => {
            icon.src = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/cdn/img/tick.svg'; // give user feedback, else they'll think it broke
            setTimeout(() => {
            icon.src = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/cdn/img/clip.svg'; // normal again
            }, 1000);
        })
        .catch(console.error);
    });

    bookContainer.style.position = 'relative';
    bookContainer.appendChild(btn);
  }

  // add the qustion stuff starts here
  function addQuestionClipboard() {
    const questionContainer = document.querySelector('.PanelPaperbackQuestionContainer');
    if (!questionContainer || questionContainer.querySelector('.book-copy-btn-question')) return;

    const btn = document.createElement('button');
    btn.className = 'book-copy-btn-question';
    btn.title = 'Copy question';

    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('cdn/img/clip.svg');
    icon.alt = '';
    icon.draggable = false;
    icon.width = 18;
    icon.height = 18;

    btn.appendChild(icon);


    btn.addEventListener('click', () => {
      const qNumber = questionContainer.querySelector('h2 span')?.innerText.trim() || '';
      const qTextDiv = questionContainer.querySelector('h2 > div, h2 > span + div');
      const qText = qTextDiv?.innerText.trim() || '';
      const options = Array.from(questionContainer.querySelectorAll('button > div'))
        .map(d => d.innerText.trim())
        .filter(Boolean);

      if (!qNumber || !qText || options.length === 0) return;

      const formatted =
        `This is a question for the latest text, answer using exactly one of the
            options below, into a codebox and say nothing more\n\n\n${qNumber} ${qText}\n${options.join('\n')}`;

      navigator.clipboard.writeText(formatted)
        .then(() => {
            icon.src = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/cdn/img/tick.svg';
            setTimeout(() => {
            icon.src = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/cdn/img/clip.svg';
            }, 1000);
        })
        .catch(console.error);
    });

    questionContainer.style.position = 'relative';
    questionContainer.appendChild(btn);
  }

  // run stuff
  addBookClipboard();     // this adds the clipboard
  addQuestionClipboard(); // icon to the book and Question                           

  // watch the pages for changes
  let observerTimeout;
  const observer = new MutationObserver(() => {
    if (observerTimeout) return;
    observerTimeout = setTimeout(() => {
      addBookClipboard();
      addQuestionClipboard();
      observerTimeout = null;
    }, 200);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
