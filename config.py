"""
Configuration settings for SimpleMeet application.
"""
import os
from typing import Optional

class Config:
    """Base configuration class."""
    
    # Flask Configuration
    SECRET_KEY: Optional[str] = os.environ.get('SECRET_KEY')
    
    # Database Configuration
    DB_DIR: str = 'db'
    DB_PATH: str = os.path.join(DB_DIR, 'locations.db')
    
    # Location sharing settings
    SHARE_EXPIRY_HOURS: int = int(os.environ.get('SHARE_EXPIRY_HOURS', 24))
    MAX_USERS_PER_SHARE: int = int(os.environ.get('MAX_USERS_PER_SHARE', 50))
    
    # Rate limiting
    LOCATION_UPDATE_RATE_LIMIT: int = int(os.environ.get('LOCATION_UPDATE_RATE_LIMIT', 2))  # seconds
    MAX_LOCATION_HISTORY: int = int(os.environ.get('MAX_LOCATION_HISTORY', 100))
    
    # Security settings
    SESSION_TIMEOUT_MINUTES: int = int(os.environ.get('SESSION_TIMEOUT_MINUTES', 120))
    MAX_USERNAME_LENGTH: int = int(os.environ.get('MAX_USERNAME_LENGTH', 20))
    MIN_USERNAME_LENGTH: int = int(os.environ.get('MIN_USERNAME_LENGTH', 3))
    
    # Cleanup settings
    CLEANUP_INTERVAL_MINUTES: int = int(os.environ.get('CLEANUP_INTERVAL_MINUTES', 30))
    STALE_USER_TIMEOUT_MINUTES: int = int(os.environ.get('STALE_USER_TIMEOUT_MINUTES', 10))
    
    # Server settings
    HOST: str = os.environ.get('HOST', '0.0.0.0')
    PORT: int = int(os.environ.get('PORT', 5000))
    DEBUG: bool = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    # CORS settings
    CORS_ORIGINS: str = os.environ.get('CORS_ORIGINS', '*')
    
    # Logging
    LOG_LEVEL: str = os.environ.get('LOG_LEVEL', 'INFO')
    LOG_FILE: str = os.environ.get('LOG_FILE', 'simplemeet.log')

class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    LOG_LEVEL = 'DEBUG'

class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    LOG_LEVEL = 'WARNING'
    
    # Enhanced security for production
    SESSION_TIMEOUT_MINUTES = 60
    MAX_USERS_PER_SHARE = 20

class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    DB_PATH = ':memory:'  # Use in-memory database for tests
    DEBUG = True

# Configuration mapping
config_mapping = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}

def get_config(config_name: Optional[str] = None) -> Config:
    """Get configuration based on environment or provided name."""
    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'default')
    
    return config_mapping.get(config_name, DevelopmentConfig) 