document.getElementById('registrationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
  
    try {
      const formData = {
        username: document.getElementById('username').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        events: []
      };
  
      const response = await fetch('http://localhost:3000/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
  
      if (response.ok) {
        alert('User registered successfully');
        window.location.href = 'login.html'; // Redirect to login page
      } else {
        const errorData = await response.json();
        alert(`Registration failed: ${errorData.error}`);
      }
    } catch (error) {
      console.error('Error registering user:', error);
      alert('Registration failed. Please try again later.');
    }
  });