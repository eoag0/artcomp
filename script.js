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
const finalistsGrid = document.getElementById('finalists-grid');
const votingForm = document.getElementById('voting-form');
const votingStatus = document.getElementById('voting-status');
const is3DInput = document.getElementById('is-3d');
const artLengthInput = document.getElementById('art-length');
const artWidthInput = document.getElementById('art-width');
const artHeightInput = document.getElementById('art-height');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isImageSubmission(submission) {
  if (typeof submission.fileType === 'string' && submission.fileType.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(String(submission.fileUrl || ''));
}

function buildArtworkCard(submission) {
  const preview = isImageSubmission(submission)
    ? `<img src="${escapeHtml(submission.fileUrl)}" alt="${escapeHtml(submission.artTitle)} preview" loading="lazy" />`
    : `<div class="file-preview">Preview unavailable</div>`;

  return `
    <article class="art-slot submission-card">
      <div class="art-preview">
        ${preview}
      </div>
      <div class="art-header">
        <strong class="art-title">${escapeHtml(submission.artTitle)}</strong>
        ${submission.referenceNumber ? `<small class="submission-badge">Ref ${escapeHtml(submission.referenceNumber)}</small>` : ''}
      </div>
      <div class="submission-meta">
        <small>${submission.is3D ? '3D artwork' : '2D artwork'}</small>
        ${submission.artDescription ? `<small>${escapeHtml(submission.artDescription)}</small>` : ''}
      </div>
    </article>
  `;
}

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

  galleryGrid.innerHTML = '';

  submissions.slice(0, 8).forEach((submission) => {
    const article = document.createElement('div');
    article.innerHTML = buildArtworkCard(submission);
    galleryGrid.appendChild(article.firstElementChild);
  });
}

function renderFinalistCards(submissions) {
  if (!finalistsGrid) return;

  finalistsGrid.innerHTML = '';
  if (!Array.isArray(submissions) || submissions.length === 0) {
    finalistsGrid.innerHTML = '<article class="art-slot"><span>No finalist tags yet.</span></article>';
    return;
  }

  submissions.forEach((submission) => {
    const article = document.createElement('div');
    article.innerHTML = buildArtworkCard(submission);
    finalistsGrid.appendChild(article.firstElementChild);
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

async function loadFinalists() {
  try {
    const response = await fetch('/api/finalists');
    if (!response.ok) return;
    const payload = await response.json();
    renderFinalistCards(payload.submissions || []);
  } catch {
    // Keep placeholder if backend is unavailable.
  }
}

if (submissionForm && submissionStatus) {
  if (is3DInput && artHeightInput) {
    const syncHeightState = () => {
      const useHeight = is3DInput.checked;
      artHeightInput.disabled = !useHeight;
      artHeightInput.required = useHeight;
      if (!useHeight) artHeightInput.value = '';
    };
    syncHeightState();
    is3DInput.addEventListener('change', syncHeightState);
  }

  submissionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    submissionStatus.textContent = '';
    submissionStatus.className = 'form-status';

    const formData = new FormData(submissionForm);
    const artistName = String(formData.get('artistName') || '').trim();
    const artistAge = Number.parseInt(String(formData.get('artistAge') || ''), 10);
    const artistSchool = String(formData.get('artistSchool') || '').trim();
    const artistEmail = String(formData.get('artistEmail') || '').trim();
    const artTitle = String(formData.get('artTitle') || '').trim();
    const artLength = Number.parseFloat(String(formData.get('artLength') || ''));
    const artWidth = Number.parseFloat(String(formData.get('artWidth') || ''));
    const artHeight = Number.parseFloat(String(formData.get('artHeight') || ''));
    const is3D = formData.get('is3D') === 'on';
    const artDescription = String(formData.get('artDescription') || '').trim();
    const artFile = formData.get('artFile');

    if (
      !artistName ||
      !artistSchool ||
      !Number.isInteger(artistAge) ||
      !artistEmail ||
      !artTitle ||
      !Number.isFinite(artLength) ||
      !Number.isFinite(artWidth) ||
      !artDescription ||
      !(artFile instanceof File) ||
      artFile.size === 0
    ) {
      submissionStatus.textContent = 'Please complete all fields and choose a file.';
      submissionStatus.className = 'form-status error';
      return;
    }

    if (artistAge < 15 || artistAge > 19) {
      submissionStatus.textContent = 'Age must be between 15 and 19.';
      submissionStatus.className = 'form-status error';
      return;
    }

    if (artLength <= 0 || artWidth <= 0) {
      submissionStatus.textContent = 'Length and width must be greater than 0.';
      submissionStatus.className = 'form-status error';
      return;
    }

    if (!is3D && (artLength > 40 || artWidth > 40)) {
      submissionStatus.textContent = 'For 2D artwork, max size is 40 x 40 inches.';
      submissionStatus.className = 'form-status error';
      return;
    }

    if (is3D) {
      if (!Number.isFinite(artHeight) || artHeight <= 0) {
        submissionStatus.textContent = 'For 3D artwork, height is required and must be greater than 0.';
        submissionStatus.className = 'form-status error';
        return;
      }
      formData.set('artDimensions', `${artLength} x ${artWidth} x ${artHeight} in`);
    } else {
      formData.set('artDimensions', `${artLength} x ${artWidth} in`);
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
      await loadFinalists();
    } catch (error) {
      submissionStatus.textContent = error.message || 'Could not submit. Please try again.';
      submissionStatus.className = 'form-status error';
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

if (contactForm && statusNode) {
  contactForm.addEventListener('submit', async (event) => {
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

    const submitBtn = contactForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          email,
          subject,
          message,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Could not send your message right now.');
      }

      statusNode.textContent = 'Message sent successfully. Our team will follow up soon.';
      statusNode.className = 'form-status success';
      contactForm.reset();
    } catch (error) {
      statusNode.textContent = error.message || 'Could not send your message right now.';
      statusNode.className = 'form-status error';
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

if (votingForm && votingStatus) {
  votingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    votingStatus.textContent = '';
    votingStatus.className = 'form-status';

    const formData = new FormData(votingForm);
    const email = String(formData.get('voterEmail') || '').trim();
    const referenceNumber = String(formData.get('referenceNumber') || '').trim().toUpperCase();

    if (!email || !referenceNumber) {
      votingStatus.textContent = 'Please enter both email and reference number.';
      votingStatus.className = 'form-status error';
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      votingStatus.textContent = 'Please enter a valid email address.';
      votingStatus.className = 'form-status error';
      return;
    }

    const submitBtn = votingForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const response = await fetch('/api/votes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, referenceNumber }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Vote submission failed.');
      }

      votingStatus.textContent = 'Vote submitted. Thank you for participating.';
      votingStatus.className = 'form-status success';
      votingForm.reset();
    } catch (error) {
      votingStatus.textContent = error.message || 'Could not submit vote.';
      votingStatus.className = 'form-status error';
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

const yearNode = document.getElementById('year');
if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

loadRecentSubmissions();
loadFinalists();
