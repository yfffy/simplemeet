"""
Basic tests for SimpleMeet application.
"""
import pytest
import sys
import os

# Add the parent directory to the path so we can import the app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app, init_db, validate_share_code, validate_username, sanitize_coordinates

@pytest.fixture
def client():
    """Create a test client for the Flask app."""
    app.config['TESTING'] = True
    app.config['DATABASE'] = ':memory:'  # Use in-memory database for tests
    
    with app.test_client() as client:
        with app.app_context():
            init_db()
        yield client

def test_index_route(client):
    """Test that the index route returns successfully."""
    response = client.get('/')
    assert response.status_code == 200
    assert b'SimpleMeet' in response.data

def test_validate_share_code():
    """Test share code validation function."""
    # Valid codes
    assert validate_share_code('ABC-123') == 'ABC-123'
    assert validate_share_code('abc-123') == 'ABC-123'  # Should uppercase
    assert validate_share_code(' ABC-123 ') == 'ABC-123'  # Should strip whitespace
    
    # Invalid codes
    assert validate_share_code('') is None
    assert validate_share_code('ABC123') is None  # Missing dash
    assert validate_share_code('AB-123') is None  # Too few letters
    assert validate_share_code('ABCD-123') is None  # Too many letters
    assert validate_share_code('ABC-12') is None  # Too few digits
    assert validate_share_code('ABC-1234') is None  # Too many digits
    assert validate_share_code('123-ABC') is None  # Wrong format
    assert validate_share_code(None) is None
    assert validate_share_code(123) is None  # Not a string

def test_validate_username():
    """Test username validation function."""
    # Valid usernames
    assert validate_username('User123') == 'User123'
    assert validate_username('My Name') == 'My Name'
    assert validate_username('user-name_123') == 'user-name_123'
    assert validate_username(' TestUser ') == 'TestUser'  # Should strip whitespace
    
    # Invalid usernames
    assert validate_username('') is None
    assert validate_username('AB') is None  # Too short
    assert validate_username('A' * 21) is None  # Too long
    assert validate_username('User@Name') is None  # Invalid characters
    assert validate_username('<script>') is None  # Invalid characters
    assert validate_username(None) is None
    assert validate_username(123) is None  # Not a string

def test_sanitize_coordinates():
    """Test coordinate sanitization function."""
    # Valid coordinates
    lat, lon = sanitize_coordinates(40.7128, -74.0060)  # NYC
    assert lat == 40.7128
    assert lon == -74.0060
    
    lat, lon = sanitize_coordinates('40.7128', '-74.0060')  # String input
    assert lat == 40.7128
    assert lon == -74.0060
    
    # Invalid coordinates
    lat, lon = sanitize_coordinates(91, 0)  # Lat out of range
    assert lat is None
    assert lon is None
    
    lat, lon = sanitize_coordinates(0, 181)  # Lon out of range
    assert lat is None
    assert lon is None
    
    lat, lon = sanitize_coordinates('invalid', 0)  # Invalid input
    assert lat is None
    assert lon is None
    
    lat, lon = sanitize_coordinates(None, None)  # None input
    assert lat is None
    assert lon is None

if __name__ == '__main__':
    pytest.main([__file__]) 