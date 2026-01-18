// content.js

// Only run on sparx-learning.com
if (window.location.hostname.endsWith('sparx-learning.com')) {

  // ---------- BOOK COPY ----------
  function addBookClipboard() {
    const bookContainer = document.querySelector('.sr_63ce408f.content');
    if (!bookContainer || bookContainer.querySelector('.book-copy-btn')) return;

    const btn = document.createElement('button');
    btn.textContent = '📋';
    btn.title = 'Copy book text';
    btn.className = 'book-copy-btn';
    btn.style.position = 'absolute';
    btn.style.top = '10px';
    btn.style.right = '10px';
    btn.style.zIndex = '9999';
    btn.style.fontSize = '20px';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', () => {
      const readContent = bookContainer.querySelector('.read-content');
      if (!readContent) return;
      const text = readContent.innerText.replace(/\s+\n/g, '\n').trim();
      const finalText = `# This is the latest text for my homework, Read it, and DO NOT print any answers, there is nothing to answer at this point, acknowlege the text and say nothing more then "Text recieved. I will wait for the options"\n\n\n${text}`;
      navigator.clipboard.writeText(finalText).then(() => {
        btn.textContent = '✅';
        setTimeout(() => (btn.textContent = '📋'), 1000);
      });
    });

    bookContainer.style.position = 'relative';
    bookContainer.appendChild(btn);
  }

  // ---------- QUESTION COPY ----------
  function addQuestionClipboard() {
    const questionContainer = document.querySelector('.PanelPaperbackQuestionContainer');
    if (!questionContainer || questionContainer.querySelector('.question-copy-btn')) return;

    const btn = document.createElement('button');
    btn.textContent = '📋';
    btn.title = 'Copy question';
    btn.className = 'question-copy-btn';
    btn.style.position = 'absolute';
    btn.style.top = '10px';
    btn.style.right = '10px';
    btn.style.zIndex = '9999';
    btn.style.fontSize = '20px';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', () => {
      const qNumber = questionContainer.querySelector('h2 span')?.innerText.trim() || '';
      const qText = questionContainer.querySelector('.sr_554eb38b')?.innerText.trim() || '';
      const options = Array.from(questionContainer.querySelectorAll('.sr_9b822cb0 > button > div'))
        .map(div => div.innerText.trim())
        .filter(opt => opt.length > 0);

      if (!qNumber || !qText || options.length === 0) return;

      const formatted = `# This is a question for the latest text, answer using exactly one of the options below, into a codebox and say nothing more\n\n\n${qNumber} ${qText}\n${options.join('\n')}`;
      navigator.clipboard.writeText(formatted).then(() => {
        btn.textContent = '✅';
        setTimeout(() => (btn.textContent = '📋'), 1000);
      });
    });

    questionContainer.style.position = 'relative';
    questionContainer.appendChild(btn);
  }

  // Run on page load and observe for dynamic changes
  addBookClipboard();
  addQuestionClipboard();

  new MutationObserver(() => {
    addBookClipboard();
    addQuestionClipboard();
  }).observe(document.body, { childList: true, subtree: true });
}
