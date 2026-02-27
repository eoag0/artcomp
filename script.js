const nav = document.querySelector('.site-header');
const navToggle = document.querySelector('.nav-toggle');
const navLinksContainer = document.querySelector('.nav-links');
const navLinks = document.querySelectorAll('.nav-links a');
const sections = document.querySelectorAll('main section[id]');
const statusNode = document.getElementById('form-status');
const contactForm = document.getElementById('contact-form');
const statBubbles = document.querySelectorAll('.stat-bubble');
const submissionForm = document.getElementById('submission-form');
const submissionStatus = document.getElementById('submission-status');
const galleryGrid = document.getElementById('gallery-grid');

if (navToggle && navLinksContainer) {
  navToggle.addEventListener('click', () => {
    const expanded = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!expanded));
    navLinksContainer.classList.toggle('open');
  });

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      navLinksContainer.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const id = entry.target.getAttribute('id');
      navLinks.forEach((link) => {
        const isActive = link.getAttribute('href') === `#${id}`;
        link.classList.toggle('active', isActive);
      });
    });
  },
  {
    rootMargin: '-40% 0px -48% 0px',
    threshold: 0.05,
  }
);

sections.forEach((section) => sectionObserver.observe(section));

navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const targetId = link.getAttribute('href');
    if (!targetId || !targetId.startsWith('#')) return;
    const target = document.querySelector(targetId);
    if (!target) return;

    event.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - nav.offsetHeight + 1;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

function animateCount(element, target) {
  const duration = 1300;
  const start = 0;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const value = Math.round(start + (target - start) * (1 - Math.pow(1 - progress, 3)));
    element.textContent = value;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

const bubbleObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const bubble = entry.target;
      const countNode = bubble.querySelector('.count');
      const target = Number.parseInt(bubble.dataset.target || '0', 10);
      if (countNode && !bubble.dataset.animated) {
        animateCount(countNode, target);
        bubble.dataset.animated = 'true';
      }
      observer.unobserve(bubble);
    });
  },
  { threshold: 0.45 }
);

statBubbles.forEach((bubble) => bubbleObserver.observe(bubble));

function renderSubmissionCards(submissions) {
  if (!galleryGrid) return;

  const dynamicCards = galleryGrid.querySelectorAll('.submission-card');
  dynamicCards.forEach((card) => card.remove());

  submissions.slice(0, 8).forEach((submission) => {
    const article = document.createElement('article');
    article.className = 'art-slot submission-card';

    const uploadedDate = new Date(submission.submittedAt);
    const dateLabel = Number.isNaN(uploadedDate.getTime())
      ? 'Unknown date'
      : uploadedDate.toLocaleDateString();

    article.innerHTML = `
      <div class="submission-meta">
        <strong>${submission.artTitle}</strong>
        <small>by ${submission.artistName}</small>
        <small>${dateLabel}</small>
        <a href="${submission.fileUrl}" target="_blank" rel="noopener">View File</a>
      </div>
    `;

    galleryGrid.appendChild(article);
  });
}

async function loadRecentSubmissions() {
  try {
    const response = await fetch('/api/submissions');
    if (!response.ok) return;
    const payload = await response.json();
    if (Array.isArray(payload.submissions) && payload.submissions.length > 0) {
      renderSubmissionCards(payload.submissions);
    }
  } catch {
    // Keep placeholders if backend is unavailable.
  }
}

if (submissionForm && submissionStatus) {
  submissionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    submissionStatus.textContent = '';
    submissionStatus.className = 'form-status';

    const formData = new FormData(submissionForm);
    const artistName = String(formData.get('artistName') || '').trim();
    const artistEmail = String(formData.get('artistEmail') || '').trim();
    const artTitle = String(formData.get('artTitle') || '').trim();
    const artFile = formData.get('artFile');

    if (!artistName || !artistEmail || !artTitle || !(artFile instanceof File) || artFile.size === 0) {
      submissionStatus.textContent = 'Please complete all fields and choose a file.';
      submissionStatus.className = 'form-status error';
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(artistEmail)) {
      submissionStatus.textContent = 'Please provide a valid email address.';
      submissionStatus.className = 'form-status error';
      return;
    }

    const submitBtn = submissionForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const response = await fetch('/api/submissions', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Submission failed.');
      }

      submissionStatus.textContent = 'Artwork submitted successfully.';
      submissionStatus.className = 'form-status success';
      submissionForm.reset();
      await loadRecentSubmissions();
    } catch (error) {
      submissionStatus.textContent = error.message || 'Could not submit. Please try again.';
      submissionStatus.className = 'form-status error';
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

if (contactForm && statusNode) {
  contactForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(contactForm);

    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const subject = String(formData.get('subject') || '').trim();
    const message = String(formData.get('message') || '').trim();

    if (!name || !email || !subject || !message) {
      statusNode.textContent = 'Please complete all required fields.';
      statusNode.className = 'form-status error';
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      statusNode.textContent = 'Please enter a valid email address.';
      statusNode.className = 'form-status error';
      return;
    }

    statusNode.textContent = 'Message sent successfully. Our team will follow up soon.';
    statusNode.className = 'form-status success';
    contactForm.reset();
  });
}

const yearNode = document.getElementById('year');
if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

loadRecentSubmissions();
