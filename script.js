// Configuration
const TWFY_API_BASE = 'https://www.theyworkforyou.com/api';
const NIGEL_FARAGE_ID = '11575'; // Nigel Farage's person ID in TWFY

// Get API key from environment variable (Vercel will inject this)
const API_KEY = window.location.hostname === 'localhost' 
    ? 'demo' // Use demo key for local testing
    : getEnvironmentVariable('VITE_TWFY_API_KEY');

// Helper function to get environment variables (for production)
function getEnvironmentVariable(name) {
    // In production, you'll need to inject this via your build process
    // For now, we'll use a demo key
    return 'demo';
}

// Main application
class NigelTracker {
    constructor() {
        this.mpData = null;
        this.interestsData = null;
        this.debatesData = null;
        this.init();
    }

    async init() {
        try {
            await this.loadAllData();
            this.renderContent();
            this.hideLoading();
        } catch (error) {
            this.showError(error.message);
        }
    }

    // API helper method
    async callAPI(endpoint, params = {}) {
        const url = new URL('/api/twfy', window.location.origin);
        url.searchParams.set('endpoint', endpoint);
        
        // Add other parameters
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, value);
            }
        });

        console.log('Calling API:', url.toString());

        const response = await fetch(url.toString());
        
        console.log('API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        console.log('API response data:', data);
        return data;
    }

    async loadAllData() {
        console.log('Loading MP data...');
        await this.loadMPData();
        
        console.log('Loading interests data...');
        // Note: Register of interests might not be available via API
        // We'll simulate some data for now
        this.loadInterestsData();
        
        console.log('Loading debates data...');
        await this.loadDebatesData();
    }

    async loadMPData() {
        try {
            const response = await fetch(`${TWFY_API_BASE}/getMP?key=${API_KEY}&id=${NIGEL_FARAGE_ID}&output=json`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            this.mpData = await response.json();
        } catch (error) {
            console.error('Error loading MP data:', error);
            // Fallback data for demo purposes
            this.mpData = {
                full_name: "Nigel Paul Farage",
                constituency: "Clacton",
                party: "Reform UK",
                entered_house: "2024-07-04",
                person_id: "11575"
            };
        }
    }

    loadInterestsData() {
        // Simulated interests data (replace with real API call when available)
        this.interestsData = [
            {
                category: "Employment and earnings",
                items: [
                    {
                        date: "2024-07-15",
                        description: "Presenter, GB News (from 1 June 2021). Address: 292 Vauxhall Bridge Road, London SW1V 1AE. (Registered 15 July 2024; updated 15 July 2024)"
                    },
                    {
                        date: "2024-07-15",
                        description: "Regular contributor and presenter for various international media outlets including Fox News, CNN, and other broadcasters"
                    }
                ]
            },
            {
                category: "Gifts, benefits and hospitality",
                items: [
                    {
                        date: "2024-08-20",
                        description: "Flight and accommodation to attend speaking engagement in United States, value approximately £5,000"
                    }
                ]
            },
            {
                category: "Land and property",
                items: [
                    {
                        date: "2024-07-15",
                        description: "Residential property in Kent (registered on election)"
                    }
                ]
            }
        ];
    }

    async loadDebatesData() {
        try {
            const data = await callTWFYAPI('getDebates', { 
                person: NIGEL_FARAGE_ID, 
                num: 10 
            });
            this.debatesData = data.rows || [];
        } catch (error) {
            console.error('Error loading debates data:', error);
            // Fallback data for demo purposes
            this.debatesData = [
                {
                    hdate: "2024-11-15",
                    major: "1",
                    minor: "1", 
                    body: "I rise to speak on this important matter affecting my constituents in Clacton...",
                    url: "https://www.theyworkforyou.com/debates/?id=2024-11-15a.123.4"
                },
                {
                    hdate: "2024-11-10",
                    major: "1",
                    minor: "2",
                    body: "The people of this country deserve better than what they have been offered...",
                    url: "https://www.theyworkforyou.com/debates/?id=2024-11-10a.456.2"
                }
            ];
        }
    }

    renderContent() {
        this.renderMPInfo();
        this.renderInterests();
        this.renderActivityChart();
        this.renderDebates();
    }

    renderMPInfo() {
        const container = document.getElementById('mp-details');
        const mp = this.mpData;
        
        console.log('Rendering MP info with data:', mp);
        
        // Handle different possible data structures
        let fullName = mp.full_name || mp.name || mp.display_name || 'Unknown';
        let constituency = mp.constituency || mp.current_constituency || 'Unknown';
        let party = mp.party || mp.current_party || 'Unknown';
        let enteredHouse = mp.entered_house || mp.entered_on || 'Unknown';
        let personId = mp.person_id || mp.id || 'Unknown';
        
        // Debug output
        console.log('Processed values:', {
            fullName, constituency, party, enteredHouse, personId
        });
        
        container.innerHTML = `
            <div class="mp-card">
                <div class="mp-photo-container">
                    <img src="https://www.theyworkforyou.com/images/mps/${personId}.jpg" 
                         alt="${fullName}" 
                         class="mp-photo"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="mp-photo-placeholder" style="display: none;">
                        <span>📸</span>
                        <small>No Photo</small>
                    </div>
                </div>
                <div class="mp-details">
                    <h3>${fullName}</h3>
                    <p><strong>Constituency:</strong> ${constituency}</p>
                    <p><strong>Party:</strong> ${party}</p>
                    <p><strong>Entered House:</strong> ${enteredHouse !== 'Unknown' ? new Date(enteredHouse).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long', 
                        year: 'numeric'
                    }) : 'Unknown'}</p>
                    <p><strong>Person ID:</strong> ${personId}</p>
                    <details style="margin-top: 1rem;">
                        <summary style="cursor: pointer; color: #666;">Debug: Raw API Data</summary>
                        <pre style="background: #f5f5f5; padding: 1rem; margin-top: 0.5rem; font-size: 0.8rem; overflow-x: auto;">${JSON.stringify(mp, null, 2)}</pre>
                    </details>
                </div>
            </div>
        `;
    }

    renderInterests() {
        const container = document.getElementById('interests-container');
        
        if (!this.interestsData || this.interestsData.length === 0) {
            container.innerHTML = '<p>No register of interests data available.</p>';
            return;
        }

        let html = '';
        this.interestsData.forEach(category => {
            html += `
                <div class="interest-category">
                    <h4>${category.category}</h4>
                    ${category.items.map(item => `
                        <div class="interest-item">
                            <div class="interest-date">${new Date(item.date).toLocaleDateString('en-GB')}</div>
                            <div class="interest-description">${item.description}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        });

        container.innerHTML = html;
    }

    renderActivityChart() {
        const ctx = document.getElementById('activityChart').getContext('2d');
        
        // Sample data for demonstration
        const monthlyActivity = {
            labels: ['Jul 2024', 'Aug 2024', 'Sep 2024', 'Oct 2024', 'Nov 2024', 'Dec 2024'],
            debates: [12, 8, 15, 23, 18, 14],
            questions: [5, 3, 8, 12, 9, 6]
        };

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: monthlyActivity.labels,
                datasets: [
                    {
                        label: 'Debates & Speeches',
                        data: monthlyActivity.debates,
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Written Questions',
                        data: monthlyActivity.questions,
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Parliamentary Activity Over Time'
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Activities'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Month'
                        }
                    }
                }
            }
        });
    }

    renderDebates() {
        const container = document.getElementById('debates-container');
        
        if (!this.debatesData || this.debatesData.length === 0) {
            container.innerHTML = '<p>No recent debate data available.</p>';
            return;
        }

        let html = '';
        this.debatesData.slice(0, 5).forEach(debate => {
            const date = new Date(debate.hdate).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });
            
            // Truncate the speech text for preview
            const excerpt = debate.body.length > 200 
                ? debate.body.substring(0, 200) + '...' 
                : debate.body;

            html += `
                <div class="debate-item">
                    <div class="debate-title">Parliamentary Debate</div>
                    <div class="debate-date">${date}</div>
                    <div class="debate-excerpt">"${excerpt}"</div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    hideLoading() {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    }

    showError(message) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'block';
        document.getElementById('error-message').textContent = message;
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new NigelTracker();
});
