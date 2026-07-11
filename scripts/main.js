// ===== Mobile nav toggle =====
const header = document.querySelector('.site-header');
const burger = document.querySelector('.burger');

burger.addEventListener('click', () => {
  const open = header.classList.toggle('open');
  burger.setAttribute('aria-expanded', String(open));
});

header.querySelectorAll('.nav a').forEach((a) => {
  a.addEventListener('click', () => {
    header.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
  });
});

// ===== Header color switch (over dark sections) =====
const hero = document.querySelector('.hero');
if (hero) {
  const hdrObserver = new IntersectionObserver(
    ([entry]) => {
      header.classList.toggle('scrolled', !entry.isIntersecting);
    },
    { rootMargin: '-72px 0px 0px 0px', threshold: 0 }
  );
  hdrObserver.observe(hero);
}

// ===== Scroll reveal =====
const revealEls = document.querySelectorAll(
  '.section-head, .about-content, .about-photo, .services > article, .work-card, .approach h2, .approach-photo, .process > article, .reliability-photo, .reliability-content, .contacts-left, .contact-list, .qr-wrap'
);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (reduced) {
  revealEls.forEach((el) => el.classList.add('is-visible'));
} else {
  revealEls.forEach((el) => el.classList.add('reveal'));

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          entry.target.style.transitionDelay = `${Math.min(i, 4) * 60}ms`;
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  revealEls.forEach((el) => io.observe(el));
}
