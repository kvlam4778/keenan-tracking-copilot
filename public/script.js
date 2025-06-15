// Firebase App (the core Firebase SDK) is always required and must be listed first
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// Add SDKs for Firebase products that you want to use
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp, doc, deleteDoc, setDoc, getDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : { apiKey: "DEMO_KEY", authDomain: "DEMO.firebaseapp.com", projectId: "DEMO_PROJECT" };
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-food-tracker';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setLogLevel('debug');

let userId = null;
let foodEntriesCollectionRef = null;
let checkinCollectionRef = null;
let currentEntries = [];
let currentCheckins = new Map();
let selectedImageBase64 = null;

// --- EMOJI MAPPINGS ---
const moodEmojis = ["", "😠", "😟", "😐", "🙂", "😊", "😄", "😁", "🥰", "🤩", "🥳"];
const itchinessEmojis = ["", "🙂", "🤔", "😐", "😒", "😟", "😫", "😖", "😡", "😭", "🌋"];
const appearanceEmojis = ["", "🤢", "😟", "😐", "🙂", "😊", "✨", "🤩", "💖", "👑", "🦄"];
const emojiMaps = {
    mood: moodEmojis,
    itchiness: itchinessEmojis,
    appearance: appearanceEmojis
};

// DOM Elements
const foodForm = document.getElementById('foodForm');
const mealTypeInput = document.getElementById('mealType');
const dateInput = document.getElementById('date');
const foodLogContainer = document.getElementById('foodLogContainer');
const userIdDisplay = document.getElementById('userIdDisplay');
const loadingIndicator = document.getElementById('loadingIndicator');
const authLoadingIndicator = document.getElementById('authLoadingIndicator');
const mainContent = document.getElementById('mainContent');
const messageModal = document.getElementById('messageModal');
const messageText = document.getElementById('messageText');
const closeMessageModalButton = document.getElementById('closeMessageModal');
const exportCsvButton = document.getElementById('exportCsvButton');
const proteinInput = document.getElementById('protein');
const vegetableInput = document.getElementById('vegetable');
const dairyInput = document.getElementById('dairy');
const fruitInput = document.getElementById('fruit');
const carbsInput = document.getElementById('carbs');
const otherInput = document.getElementById('other');
const imageUploadInput = document.getElementById('imageUploadInput');
const imagePreview = document.getElementById('imagePreview');
const analyzeButton = document.getElementById('analyzeButton');
const geminiLoadingIndicator = document.getElementById('geminiLoadingIndicator');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');

// Check-in UI Elements
const moodSlider = document.getElementById('moodSlider');
const itchinessSlider = document.getElementById('itchinessSlider');
const appearanceSlider = document.getElementById('appearanceSlider');
const saveCheckinButton = document.getElementById('saveCheckinButton');

// --- Authentication ---
async function setupAuth() {
    authLoadingIndicator.classList.remove('hidden');
    mainContent.classList.add('hidden');

    onAuthStateChanged(auth, async (user) => {
        try { // *** ADDED: Main try...catch block for robust startup ***
            if (user) {
                userId = user.uid;
                userIdDisplay.textContent = `Keenan's User ID: ${userId.substring(0,8)}...`;
                foodEntriesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/keenansFoodEntries`);
                checkinCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/keenansDailyCheckin`);
                loadAllData();
                authLoadingIndicator.classList.add('hidden');
                mainContent.classList.remove('hidden');
            } else {
                // If there's no user, attempt to sign in. This part already has error handling.
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(auth, __initial_auth_token);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (error) {
                    console.error("Error during sign-in:", error);
                    showMessage(`Error signing in: ${error.message}. Please check Firebase Authentication settings.`);
                    authLoadingIndicator.textContent = "Authentication failed. Please refresh.";
                }
            }
        } catch (error) {
            // *** ADDED: Catch block to handle any unexpected errors during initialization ***
            console.error("A critical error occurred during app initialization:", error);
            authLoadingIndicator.classList.add('hidden');
            mainContent.classList.remove('hidden');
            mainContent.innerHTML = `
                <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg" role="alert">
                    <strong class="font-bold">Oops! An error occurred.</strong>
                    <span class="block sm:inline">The app could not start correctly. Please try refreshing the page.</span>
                    <p class="text-sm mt-2">Error: ${error.message}</p>
                </div>
            `;
        }
    });

    // This initial trigger is a fallback if the listener doesn't fire right away.
    if (!auth.currentUser) {
         try {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                // signInWithCustomToken will trigger onAuthStateChanged
            } else {
                await signInAnonymously(auth);
            }
        } catch (error) {
            console.error("Initial anonymous sign-in attempt failed:", error);
            // Error will be handled by the main onAuthStateChanged listener's catch block.
        }
    }
}

// --- Gemini Image Analysis ---
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
        imagePreview.src = reader.result;
        selectedImageBase64 = reader.result.split(',')[1];
        imagePreviewContainer.classList.remove('hidden');
        analyzeButton.disabled = false;
        analyzeButton.classList.remove('opacity-50', 'cursor-not-allowed');
    };
    reader.readAsDataURL(file);
}

async function analyzeImageWithGemini() {
    if (!selectedImageBase64) { showMessage("Please select an image first."); return; }
    geminiLoadingIndicator.classList.remove('hidden');
    analyzeButton.disabled = true;
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const prompt = `Analyze the image of this meal. Identify the food items and categorize them into the following JSON schema. If an item isn't a clear fit, place it in 'other'. If multiple items fit one category, list them as a comma-separated string. For example, 'Chicken, Fish' for protein. If a category is empty, return an empty string.`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: selectedImageBase64 }}]}], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { protein: { "type": "STRING" }, vegetable: { "type": "STRING" }, dairy: { "type": "STRING" }, fruit: { "type": "STRING" }, carbs: { "type": "STRING" }, other: { "type": "STRING" }}, required: ["protein", "vegetable", "dairy", "fruit", "carbs", "other"] }}};
    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) { const errorBody = await response.text(); throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`); }
        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts.length > 0) {
            const foodData = JSON.parse(result.candidates[0].content.parts[0].text);
            proteinInput.value = foodData.protein || '';
            vegetableInput.value = foodData.vegetable || '';
            dairyInput.value = foodData.dairy || '';
            fruitInput.value = foodData.fruit || '';
            carbsInput.value = foodData.carbs || '';
            otherInput.value = foodData.other || '';
            showMessage("Food analysis complete! Review the fields and save.");
        } else { throw new Error("Invalid response structure from Gemini API."); }
    } catch (error) {
        console.error("Error analyzing image with Gemini: ", error);
        showMessage(`An error occurred during analysis: ${error.message}`);
    } finally {
        geminiLoadingIndicator.classList.add('hidden');
        analyzeButton.disabled = false;
    }
}

// --- Data Loading and Saving ---
function loadAllData() {
    if (!userId) return;
    loadFoodEntries();
    loadAllCheckins();
    loadCheckinForDate(dateInput.value);
}

async function addFoodEntry(e) {
    e.preventDefault();
    if (!userId) { showMessage("Not authenticated."); return; }
    const foodData = { protein: proteinInput.value.trim(), vegetable: vegetableInput.value.trim(), dairy: dairyInput.value.trim(), fruit: fruitInput.value.trim(), carbs: carbsInput.value.trim(), other: otherInput.value.trim() };
    if (Object.values(foodData).every(val => val === '')) { showMessage("Please fill in at least one food category."); return; }
    try {
        loadingIndicator.classList.remove('hidden');
        await addDoc(foodEntriesCollectionRef, { ...foodData, mealType: mealTypeInput.value, date: dateInput.value, loggedAt: serverTimestamp() });
        foodForm.reset();
        setDefaultDate();
        imagePreview.src = "";
        imagePreviewContainer.classList.add('hidden');
        selectedImageBase64 = null;
    } catch (error) { console.error("Error adding food entry: ", error); showMessage(`Error adding food: ${error.message}`);
    } finally { loadingIndicator.classList.add('hidden'); }
}

async function saveCheckin() {
    if (!userId) { showMessage("Not authenticated."); return; }
    const date = dateInput.value;
    if (!date) { showMessage("Please select a date first."); return; }
    const checkinData = {
        mood: moodSlider.value,
        itchiness: itchinessSlider.value,
        appearance: appearanceSlider.value,
        date: date
    };
    try {
        await setDoc(doc(checkinCollectionRef, date), checkinData);
        showMessage("Daily check-in saved successfully!");
    } catch (error) {
        console.error("Error saving check-in: ", error);
        showMessage(`Error saving check-in: ${error.message}`);
    }
}

function loadFoodEntries() {
    if (!userId) return;
    onSnapshot(query(foodEntriesCollectionRef), (snapshot) => {
        currentEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAllEntries();
    });
}

function loadAllCheckins() {
    if (!userId) return;
    onSnapshot(query(checkinCollectionRef), (snapshot) => {
        currentCheckins.clear();
        snapshot.docs.forEach(doc => currentCheckins.set(doc.id, doc.data()));
        renderAllEntries();
    });
}

async function loadCheckinForDate(date) {
    if (!userId) return;
    const docRef = doc(checkinCollectionRef, date);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        moodSlider.value = data.mood;
        itchinessSlider.value = data.itchiness;
        appearanceSlider.value = data.appearance;
    } else {
        moodSlider.value = 5;
        itchinessSlider.value = 1;
        appearanceSlider.value = 5;
    }
    updateAllSliderDisplays();
}

function renderAllEntries() {
    foodLogContainer.innerHTML = '';
    const allItems = [...currentEntries, ...Array.from(currentCheckins.values())];
    if (allItems.length === 0) {
        foodLogContainer.innerHTML = '<p class="text-gray-500 text-center py-4">No entries logged yet, Keenan. Add some!</p>';
        exportCsvButton.disabled = true;
        exportCsvButton.classList.add('opacity-50', 'cursor-not-allowed');
        return;
    }
    exportCsvButton.disabled = false;
    exportCsvButton.classList.remove('opacity-50', 'cursor-not-allowed');

    const groupedByDate = allItems.reduce((acc, entry) => {
        const date = entry.date;
        if (!acc[date]) acc[date] = { foods: [], checkin: null };
        if (entry.mealType) acc[date].foods.push(entry);
        else acc[date].checkin = entry;
        return acc;
    }, {});

    const sortedDates = Object.keys(groupedByDate).sort((a,b) => new Date(b) - new Date(a));

    sortedDates.forEach(date => {
        const { foods, checkin } = groupedByDate[date];
        foods.sort((a, b) => (a.loggedAt?.toMillis() || 0) - (b.loggedAt?.toMillis() || 0));

        const dateHeader = document.createElement('h3');
        dateHeader.className = 'text-xl font-semibold text-orange-700 mt-6 mb-3';
        dateHeader.textContent = formatDateDisplay(date);
        foodLogContainer.appendChild(dateHeader);

        if (checkin) {
            const checkinDiv = document.createElement('div');
            checkinDiv.className = 'bg-yellow-50 p-3 rounded-lg shadow-inner mb-3 flex justify-around items-center text-center';
            checkinDiv.innerHTML = `
                <div>
                    <span class="text-3xl">${emojiMaps.mood[checkin.mood]}</span>
                    <p class="text-xs text-gray-600">Mood: ${checkin.mood}/10</p>
                </div>
                <div>
                    <span class="text-3xl">${emojiMaps.itchiness[checkin.itchiness]}</span>
                    <p class="text-xs text-gray-600">Itchiness: ${checkin.itchiness}/10</p>
                </div>
                <div>
                    <span class="text-3xl">${emojiMaps.appearance[checkin.appearance]}</span>
                    <p class="text-xs text-gray-600">Appearance: ${checkin.appearance}/10</p>
                </div>
            `;
            foodLogContainer.appendChild(checkinDiv);
        }

        if (foods.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'space-y-2';
            foods.forEach(entry => {
                const foodItems = [entry.protein, entry.vegetable, entry.dairy, entry.fruit, entry.carbs, entry.other].filter(Boolean).join(', ');
                const li = document.createElement('li');
                li.className = 'bg-white p-4 rounded-lg shadow flex justify-between items-center';
                li.innerHTML = `
                    <div>
                        <p class="font-medium text-gray-800">${foodItems || "General Entry"}</p>
                        <p class="text-sm text-gray-600">Meal: ${entry.mealType}</p>
                    </div>
                    <button data-id="${entry.id}" data-name="${foodItems}" class="delete-food-btn p-1 rounded hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-red-500 hover:text-red-700"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12.56 0c1.153 0 2.242.078 3.223.224C9.308 5.78 9.93 5.69 10.59 5.69m0 0c0 .319.029.636.084.943m3.074 0a48.48 48.48 0 0 1-3.478-.397m-12.56 0c1.153 0 2.242.078 3.223.224C9.308 5.78 9.93 5.69 10.59 5.69m0 0c0 .319.029.636.084.943m0 0c.319.029.636.084.943.084m6.148-3.541a48.473 48.473 0 0 0-3.478-.397m3.478.397a48.473 48.473 0 0 1 3.478.397m-11.516 12.176a2.25 2.25 0 0 1 2.244-2.077h4.512a2.25 2.25 0 0 1 2.244 2.077L18.16 19.673m-13.388 0L4.772 5.79m13.388 0a48.108 48.108 0 0 0-3.478-.397m-12.56 0c1.153 0 2.242.078 3.223.224C9.308 5.78 9.93 5.69 10.59 5.69m0 0c0 .319.029.636.084.943m3.074 0a48.48 48.48 0 0 1-3.478-.397m-12.56 0c1.153 0 2.242.078 3.223.224C9.308 5.78 9.93 5.69 10.59 5.69m0 0c0 .319.029.636.084.943m0 0c.319.029.636.084.943.084m6.148-3.541a48.473 48.473 0 0 0-3.478-.397m3.478.397a48.473 48.473 0 0 1 3.478.397" /></svg>
                    </button>
                `;
                ul.appendChild(li);
            });
            foodLogContainer.appendChild(ul);
        }
    });
}

async function deleteFoodEntry(entryId) {
    if (!userId) return;
    try { await deleteDoc(doc(foodEntriesCollectionRef, entryId)); } 
    catch (error) { console.error("Error deleting food entry: ", error); showMessage(`Error deleting food: ${error.message}`); }
}

// --- UI & Utility Functions ---
function updateSliderDisplay(event) {
    const slider = event.target;
    const type = slider.id.replace('Slider', '');
    document.getElementById(`${type}Value`).textContent = slider.value;
    document.getElementById(`${type}Emoji`).textContent = emojiMaps[type][slider.value];
}

function updateAllSliderDisplays() {
    ['mood', 'itchiness', 'appearance'].forEach(type => {
        const slider = document.getElementById(`${type}Slider`);
        if(slider) {
            document.getElementById(`${type}Value`).textContent = slider.value;
            document.getElementById(`${type}Emoji`).textContent = emojiMaps[type][slider.value];
        }
    });
}

function exportToCsv() {
    if (currentEntries.length === 0 && currentCheckins.size === 0) {
        showMessage("There's nothing to export yet!");
        return;
    }

    const sanitize = (value) => {
        const str = String(value || ''); // Ensure value is a string and handle null/undefined
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const headers = ['Date', 'Type', 'Meal Type', 'Protein', 'Vegetable', 'Dairy', 'Fruit', 'Carbs', 'Other', 'Mood', 'Itchiness', 'Appearance'];
    
    const rows = [];
    
    // Combine and sort all items by date
    const allItems = [...currentEntries, ...Array.from(currentCheckins.values())];
    allItems.sort((a,b) => new Date(b.date) - new Date(a.date));

    allItems.forEach(item => {
        if (item.mealType) { // It's a food entry
            rows.push([
                sanitize(item.date),
                'Food',
                sanitize(item.mealType),
                sanitize(item.protein),
                sanitize(item.vegetable),
                sanitize(item.dairy),
                sanitize(item.fruit),
                sanitize(item.carbs),
                sanitize(item.other),
                '', '', '' // Empty cells for check-in data
            ].join(','));
        } else { // It's a check-in
             rows.push([
                sanitize(item.date),
                'Check-in',
                '', '', '', '', '', '', '', // Empty cells for food data
                sanitize(item.mood),
                sanitize(item.itchiness),
                sanitize(item.appearance)
            ].join(','));
        }
    });


    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "keenans_eats_log.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function setDefaultDate() { const today = new Date(); dateInput.value = today.toISOString().split('T')[0]; }
function formatDateDisplay(dateString) { const date = new Date(dateString + 'T00:00:00'); return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });}
function showMessage(message) { messageText.textContent = message; messageModal.classList.remove('hidden'); }
closeMessageModalButton.addEventListener('click', () => messageModal.classList.add('hidden'));

let entryToDeleteId = null;
function confirmDeleteEntry(entryId, foodName) {
    entryToDeleteId = entryId;
    document.getElementById('confirmDeleteText').textContent = `Are you sure you want to delete "${foodName}"?`;
    document.getElementById('confirmDeleteModal').classList.remove('hidden');
}

document.getElementById('confirmDeleteButton').addEventListener('click', () => { if (entryToDeleteId) deleteFoodEntry(entryToDeleteId); document.getElementById('confirmDeleteModal').classList.add('hidden'); });
document.getElementById('cancelDeleteButton').addEventListener('click', () => document.getElementById('confirmDeleteModal').classList.add('hidden'));
foodLogContainer.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-food-btn');
    if (deleteBtn) {
        confirmDeleteEntry(deleteBtn.dataset.id, deleteBtn.dataset.name);
    }
});

// --- Event Listeners ---
foodForm.addEventListener('submit', addFoodEntry);
exportCsvButton.addEventListener('click', exportToCsv);
imageUploadInput.addEventListener('change', handleImageUpload);
analyzeButton.addEventListener('click', analyzeImageWithGemini);
saveCheckinButton.addEventListener('click', saveCheckin);
moodSlider.addEventListener('input', updateSliderDisplay);
itchinessSlider.addEventListener('input', updateSliderDisplay);
appearanceSlider.addEventListener('input', updateSliderDisplay);
dateInput.addEventListener('change', (e) => loadCheckinForDate(e.target.value));

// --- Initialization ---
window.onload = () => { setDefaultDate(); setupAuth(); };
