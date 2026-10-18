const API_ROOT = 'https://www.themealdb.com/api/json/v1/1';
const FAVORITES_KEY = 'simmer-recipe-favorites';

const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const categorySelect = document.querySelector('#category-select');
const categoryStatus = document.querySelector('#category-status');
const resultsTitle = document.querySelector('#results-title');
const resultsSummary = document.querySelector('#results-summary');
const resultsRegion = document.querySelector('#results-region');
const surpriseButton = document.querySelector('#surprise-button');
const favoritesToggle = document.querySelector('#favorites-toggle');
const favoriteCount = document.querySelector('#favorite-count');
const modal = document.querySelector('#recipe-modal');
const modalDialog = document.querySelector('.modal-dialog');
const modalContent = document.querySelector('#modal-content');
const modalClose = document.querySelector('#modal-close');
const toast = document.querySelector('#toast');

let mealsOnScreen = [];
let lastResults = [];
let lastResultsTitle = 'A little inspiration';
let lastResultsSummary = 'Pick a craving and let’s get cooking.';
let showingFavorites = false;
let lastFocusedElement = null;
let activeRequest = 0;
let toastTimeout;

function readFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((meal) => meal && meal.idMeal) : [];
  } catch (error) {
    console.warn('Could not read saved favorites.', error);
    return [];
  }
}

let favorites = readFavorites();

function persistFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.warn('Could not save favorites.', error);
    showToast('Favorites could not be saved in this browser.');
  }
  updateFavoriteCount();
}

function updateFavoriteCount() {
  favoriteCount.textContent = String(favorites.length);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function escapeText(value) {
  return String(value ?? '');
}

function setSummary(title, summary) {
  resultsTitle.textContent = title;
  resultsSummary.textContent = summary;
}

function showLoading(label = 'Finding recipes…') {
  resultsRegion.setAttribute('aria-busy', 'true');
  resultsRegion.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'recipe-grid';
  grid.setAttribute('aria-label', label);
  for (let i = 0; i < 8; i += 1) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '<div class="skeleton-image"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div>';
    grid.append(card);
  }
  resultsRegion.append(grid);
}

function showError(message, retryAction) {
  resultsRegion.setAttribute('aria-busy', 'false');
  resultsRegion.replaceChildren();
  const state = document.createElement('div');
  state.className = 'error-state';
  state.innerHTML = '<div class="error-icon" aria-hidden="true">!</div><h3>That didn’t quite simmer.</h3>';
  const text = document.createElement('p');
  text.textContent = message;
  state.append(text);
  if (retryAction) {
    const retry = document.createElement('button');
    retry.className = 'button retry-button';
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', retryAction);
    state.append(retry);
  }
  resultsRegion.append(state);
}

function showEmpty(title, message) {
  resultsRegion.setAttribute('aria-busy', 'false');
  resultsRegion.replaceChildren();
  const state = document.createElement('div');
  state.className = 'empty-state';
  state.innerHTML = '<div class="empty-illustration" aria-hidden="true"><span>✳</span><div>♡</div></div>';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const description = document.createElement('p');
  description.textContent = message;
  state.append(heading, description);
  resultsRegion.append(state);
}

function isFavorite(mealId) {
  return favorites.some((meal) => meal.idMeal === mealId);
}

function toggleFavorite(meal) {
  if (!meal || !meal.idMeal) return;
  if (isFavorite(meal.idMeal)) {
    favorites = favorites.filter((saved) => saved.idMeal !== meal.idMeal);
    showToast('Removed from your favorites.');
  } else {
    const savedMeal = {
      idMeal: meal.idMeal,
      strMeal: meal.strMeal,
      strMealThumb: meal.strMealThumb,
      strCategory: meal.strCategory || '',
    };
    favorites = [savedMeal, ...favorites];
    showToast('Saved to your favorites.');
  }
  persistFavorites();
  if (showingFavorites) renderMeals(favorites, 'Your favorites', favorites.length ? `${favorites.length} saved recipe${favorites.length === 1 ? '' : 's'}.` : 'Recipes you save will show up here.');
  else renderMeals(mealsOnScreen, resultsTitle.textContent, resultsSummary.textContent);
  if (!modal.hidden && modal.dataset.mealId === meal.idMeal) renderModalFavoriteButton(meal);
}

function makeCard(meal) {
  const article = document.createElement('article');
  article.className = 'recipe-card';
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'card-open';
  openButton.setAttribute('aria-label', `View recipe: ${escapeText(meal.strMeal)}`);
  const photoWrap = document.createElement('div');
  photoWrap.className = 'card-photo-wrap';
  const photo = document.createElement('img');
  photo.className = 'card-photo';
  photo.src = meal.strMealThumb || '';
  photo.alt = '';
  photo.loading = 'lazy';
  const category = document.createElement('span');
  category.className = 'card-category';
  category.textContent = meal.strCategory || 'Recipe';
  photoWrap.append(photo, category);
  const copy = document.createElement('div');
  copy.className = 'card-copy';
  const title = document.createElement('h3');
  title.textContent = meal.strMeal || 'Untitled recipe';
  const arrow = document.createElement('span');
  arrow.className = 'card-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  copy.append(title, arrow);
  openButton.append(photoWrap, copy);
  openButton.addEventListener('click', () => openRecipe(meal.idMeal));

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = `favorite-button${isFavorite(meal.idMeal) ? ' is-saved' : ''}`;
  saveButton.setAttribute('aria-label', `${isFavorite(meal.idMeal) ? 'Remove' : 'Save'} ${escapeText(meal.strMeal)} ${isFavorite(meal.idMeal) ? 'from' : 'to'} favorites`);
  saveButton.setAttribute('aria-pressed', String(isFavorite(meal.idMeal)));
  saveButton.textContent = isFavorite(meal.idMeal) ? '♥' : '♡';
  saveButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite(meal);
  });

  article.append(openButton, saveButton);
  return article;
}

function renderMeals(meals, title = 'Recipes', summary = '') {
  mealsOnScreen = meals || [];
  if (!showingFavorites) {
    lastResults = mealsOnScreen;
    lastResultsTitle = title;
    lastResultsSummary = summary;
  }
  resultsRegion.setAttribute('aria-busy', 'false');
  setSummary(title, summary);
  resultsRegion.replaceChildren();
  if (!meals || meals.length === 0) {
    showEmpty(showingFavorites ? 'No favorites just yet.' : 'No recipes found.', showingFavorites ? 'Tap the heart on any recipe to keep it close.' : 'Try another dish or category and we’ll keep looking.');
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'recipe-grid';
  meals.forEach((meal) => grid.append(makeCard(meal)));
  resultsRegion.append(grid);
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json();
}

async function loadCategories() {
  categorySelect.disabled = true;
  categoryStatus.textContent = 'Loading categories…';
  try {
    const data = await fetchJSON(`${API_ROOT}/list.php?c=list`);
    const categories = Array.isArray(data.meals) ? data.meals : [];
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.strCategory;
      option.textContent = category.strCategory;
      categorySelect.append(option);
    });
    categoryStatus.textContent = categories.length ? 'Browse by category or search any dish.' : 'Categories are unavailable right now.';
    categorySelect.disabled = categories.length === 0;
  } catch (error) {
    console.error('Could not load meal categories.', error);
    categoryStatus.textContent = 'Categories could not load. You can still search by dish.';
    categorySelect.disabled = false;
  }
}

async function searchMeals() {
  const query = searchInput.value.trim();
  const category = categorySelect.value;
  showingFavorites = false;
  favoritesToggle.setAttribute('aria-pressed', 'false');
  favoritesToggle.querySelector('span:nth-child(2)').textContent = 'Favorites';
  if (!query && !category) {
    setSummary('A little inspiration', 'Pick a craving and let’s get cooking.');
    showEmpty('Your next favorite is out there.', 'Search for a dish, browse a category, or leave it to chance.');
    return;
  }
  const requestId = ++activeRequest;
  const heading = category && query ? `${category} recipes` : category || `Recipes for “${query}”`;
  setSummary(heading, 'Finding a few good things…');
  showLoading();
  try {
    let meals;
    if (category) {
      const data = await fetchJSON(`${API_ROOT}/filter.php?c=${encodeURIComponent(category)}`);
      meals = Array.isArray(data.meals) ? data.meals : [];
      meals = meals.map((meal) => ({ ...meal, strCategory: category }));
      if (query) meals = meals.filter((meal) => (meal.strMeal || '').toLowerCase().includes(query.toLowerCase()));
    } else {
      const data = await fetchJSON(`${API_ROOT}/search.php?s=${encodeURIComponent(query)}`);
      meals = Array.isArray(data.meals) ? data.meals : [];
    }
    if (requestId !== activeRequest) return;
    renderMeals(meals, heading, meals.length ? `${meals.length} delicious idea${meals.length === 1 ? '' : 's'} to explore.` : 'A different search might turn up a tasty surprise.');
  } catch (error) {
    if (requestId !== activeRequest) return;
    console.error('Could not search meals.', error);
    setSummary(heading, 'The recipe search ran into a little trouble.');
    showError('Check your connection and try the search again.', searchMeals);
  }
}

async function showRandomRecipe() {
  showingFavorites = false;
  favoritesToggle.setAttribute('aria-pressed', 'false');
  favoritesToggle.querySelector('span:nth-child(2)').textContent = 'Favorites';
  const requestId = ++activeRequest;
  setSummary('Surprise me', 'Finding a happy accident…');
  showLoading('Finding a surprise recipe…');
  try {
    const data = await fetchJSON(`${API_ROOT}/random.php`);
    const meal = Array.isArray(data.meals) ? data.meals[0] : null;
    if (requestId !== activeRequest) return;
    if (!meal) {
      renderMeals([], 'Surprise me', 'No surprise recipe arrived this time.');
      return;
    }
    renderMeals([meal], 'Tonight’s little surprise', 'One random recipe, picked just for you.');
  } catch (error) {
    if (requestId !== activeRequest) return;
    console.error('Could not get a random meal.', error);
    setSummary('Surprise me', 'The surprise ran into a little trouble.');
    showError('Check your connection and give Surprise me another try.', showRandomRecipe);
  }
}

function toggleFavoritesView() {
  showingFavorites = !showingFavorites;
  favoritesToggle.setAttribute('aria-pressed', String(showingFavorites));
  favoritesToggle.querySelector('span:nth-child(2)').textContent = showingFavorites ? 'Show results' : 'Favorites';
  if (showingFavorites) {
    activeRequest += 1;
    renderMeals(favorites, 'Your favorites', favorites.length ? `${favorites.length} saved recipe${favorites.length === 1 ? '' : 's'}.` : 'Recipes you save will show up here.');
  } else if (lastResults.length) {
    renderMeals(lastResults, lastResultsTitle, lastResultsSummary);
  } else if (lastResultsTitle === 'A little inspiration') {
    setSummary(lastResultsTitle, lastResultsSummary);
    showEmpty('Your next favorite is out there.', 'Search for a dish, browse a category, or leave it to chance.');
  } else {
    renderMeals(lastResults, lastResultsTitle, lastResultsSummary);
  }
}

function setModalState(type, message) {
  modalContent.replaceChildren();
  modalContent.setAttribute('aria-busy', type === 'loading' ? 'true' : 'false');
  if (type === 'loading') {
    const loading = document.createElement('div');
    loading.className = 'empty-state modal-state';
    loading.innerHTML = '<div class="empty-illustration" aria-hidden="true"><span>✳</span><div>♡</div></div><h3>Gathering the details…</h3><p>One moment while we find the recipe.</p>';
    modalContent.append(loading);
    return;
  }
  if (type === 'empty' || type === 'error') {
    const state = document.createElement('div');
    state.className = `${type === 'error' ? 'error-state' : 'empty-state'} modal-state`;
    state.innerHTML = type === 'error' ? '<div class="error-icon" aria-hidden="true">!</div><h3>Recipe details unavailable.</h3>' : '<div class="empty-illustration" aria-hidden="true"><span>✳</span><div>♡</div></div><h3>No recipe details found.</h3>';
    const text = document.createElement('p');
    text.textContent = message;
    state.append(text);
    modalContent.append(state);
  }
}

function parseVideoId(url) {
  if (!url) return '';
  const match = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : '';
}

function collectIngredients(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i += 1) {
    const ingredient = (meal[`strIngredient${i}`] || '').trim();
    const measure = (meal[`strMeasure${i}`] || '').trim();
    if (ingredient) ingredients.push({ ingredient, measure });
  }
  return ingredients;
}

function renderModalFavoriteButton(meal) {
  const button = modalContent.querySelector('.detail-favorite');
  if (!button) return;
  const saved = isFavorite(meal.idMeal);
  button.classList.toggle('is-saved', saved);
  button.setAttribute('aria-pressed', String(saved));
  button.innerHTML = `<span aria-hidden="true">${saved ? '♥' : '♡'}</span> ${saved ? 'Saved to favorites' : 'Save to favorites'}`;
}

function renderMealDetails(meal) {
  modalContent.replaceChildren();
  modalContent.setAttribute('aria-busy', 'false');
  const top = document.createElement('div');
  top.className = 'detail-top';
  const photo = document.createElement('img');
  photo.className = 'detail-photo';
  photo.src = meal.strMealThumb || '';
  photo.alt = `${escapeText(meal.strMeal)} plated meal`;
  const intro = document.createElement('div');
  intro.className = 'detail-intro';
  const category = document.createElement('p');
  category.className = 'detail-category';
  category.textContent = [meal.strCategory, meal.strArea].filter(Boolean).join(' · ') || 'A good thing to make';
  const title = document.createElement('h2');
  title.id = 'modal-title';
  title.textContent = meal.strMeal || 'Recipe';
  const origin = document.createElement('p');
  origin.className = 'detail-origin';
  origin.textContent = meal.strArea ? `A taste of ${meal.strArea}` : 'Gather a few ingredients and enjoy.';
  const favoriteButton = document.createElement('button');
  favoriteButton.className = 'detail-favorite';
  favoriteButton.type = 'button';
  favoriteButton.addEventListener('click', () => toggleFavorite(meal));
  intro.append(category, title, origin, favoriteButton);
  top.append(photo, intro);

  const body = document.createElement('div');
  body.className = 'detail-body';
  const ingredientsSection = document.createElement('section');
  const ingredientsTitle = document.createElement('h3');
  ingredientsTitle.textContent = 'Ingredients';
  const list = document.createElement('ul');
  list.className = 'ingredient-list';
  const ingredients = collectIngredients(meal);
  ingredients.forEach(({ ingredient, measure }) => {
    const item = document.createElement('li');
    const amount = document.createElement('span');
    amount.className = 'ingredient-measure';
    amount.textContent = measure;
    const name = document.createElement('span');
    name.textContent = ingredient;
    item.append(amount, name);
    list.append(item);
  });
  if (!ingredients.length) {
    const item = document.createElement('li');
    item.textContent = 'Ingredient details are not available for this recipe.';
    list.append(item);
  }
  ingredientsSection.append(ingredientsTitle, list);

  const instructionsSection = document.createElement('section');
  const instructionsTitle = document.createElement('h3');
  instructionsTitle.textContent = 'Let’s make it';
  const instructions = document.createElement('div');
  instructions.className = 'instructions';
  const paragraphs = (meal.strInstructions || '').split(/\r?\n+/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length) {
    paragraphs.forEach((paragraph) => {
      const p = document.createElement('p');
      p.textContent = paragraph;
      instructions.append(p);
    });
  } else {
    const p = document.createElement('p');
    p.textContent = 'Instructions are not available for this recipe.';
    instructions.append(p);
  }
  const videoId = parseVideoId(meal.strYoutube || '');
  if (videoId) {
    const video = document.createElement('div');
    video.className = 'video-wrap';
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${videoId}`;
    frame.title = `${escapeText(meal.strMeal)} recipe video`;
    frame.loading = 'lazy';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    video.append(frame);
    instructions.append(video);
  }
  instructionsSection.append(instructionsTitle, instructions);
  body.append(ingredientsSection, instructionsSection);
  modalContent.append(top, body);
  renderModalFavoriteButton(meal);
}

async function openRecipe(mealId) {
  if (!mealId) return;
  const requestId = ++activeRequest;
  lastFocusedElement = document.activeElement;
  modal.hidden = false;
  modal.dataset.mealId = mealId;
  document.body.classList.add('modal-open');
  setModalState('loading');
  modalClose.focus();
  try {
    const data = await fetchJSON(`${API_ROOT}/lookup.php?i=${encodeURIComponent(mealId)}`);
    if (requestId !== activeRequest || modal.hidden) return;
    const meal = Array.isArray(data.meals) ? data.meals[0] : null;
    if (!meal) {
      setModalState('empty', 'This meal may have been removed. Close this window and try another recipe.');
      return;
    }
    renderMealDetails(meal);
    modalDialog.focus();
  } catch (error) {
    if (requestId !== activeRequest || modal.hidden) return;
    console.error('Could not load recipe details.', error);
    setModalState('error', 'Check your connection, close this window, and try again.');
  }
}

function closeModal() {
  if (modal.hidden) return;
  modal.hidden = true;
  modal.dataset.mealId = '';
  activeRequest += 1;
  document.body.classList.remove('modal-open');
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  searchMeals();
});

document.querySelectorAll('.idea-chip').forEach((button) => {
  button.addEventListener('click', () => {
    searchInput.value = button.dataset.query || '';
    categorySelect.value = '';
    searchMeals();
  });
});

surpriseButton.addEventListener('click', showRandomRecipe);
favoritesToggle.addEventListener('click', toggleFavoritesView);
modalClose.addEventListener('click', closeModal);
modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
  if (event.key === 'Tab' && !modal.hidden) {
    const focusable = [...modal.querySelectorAll('button:not([disabled]), iframe, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

updateFavoriteCount();
loadCategories();
