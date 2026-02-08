/**
 * Weather service using WeatherAPI.com
 * Free tier: 1M calls/month
 * Docs: https://www.weatherapi.com/docs/
 */

interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  high: number;
  low: number;
  feelsLike: number;
}

interface WeatherAPIResponse {
  location: {
    name: string;
    region: string;
    country: string;
  };
  current: {
    temp_f: number;
    temp_c: number;
    feelslike_f: number;
    feelslike_c: number;
    condition: {
      text: string;
    };
  };
  forecast: {
    forecastday: Array<{
      day: {
        maxtemp_f: number;
        maxtemp_c: number;
        mintemp_f: number;
        mintemp_c: number;
      };
    }>;
  };
}

function getWeatherApiKey(): string {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "WEATHER_API_KEY is not set. Get a free API key from https://www.weatherapi.com and add it to your environment."
    );
  }
  return apiKey;
}

export class WeatherService {
  /**
   * Get weather for a specific location
   * @param location City name, ZIP code, coordinates (lat,lon), or IP address
   * @param useCelsius Whether to return temperatures in Celsius (default: true)
   */
  static async getWeather(
    location: string,
    useCelsius: boolean = true
  ): Promise<WeatherData> {
    const apiKey = getWeatherApiKey();
    const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(location)}&days=1`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 400) {
          throw new Error(`Invalid location: ${location}`);
        }
        throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
      }

      const data: WeatherAPIResponse = await response.json();

      const locationName = data.location.region
        ? `${data.location.name}, ${data.location.region}`
        : `${data.location.name}, ${data.location.country}`;

      return {
        location: locationName,
        temperature: useCelsius ? data.current.temp_c : data.current.temp_f,
        condition: data.current.condition.text,
        high: useCelsius
          ? data.forecast.forecastday[0].day.maxtemp_c
          : data.forecast.forecastday[0].day.maxtemp_f,
        low: useCelsius
          ? data.forecast.forecastday[0].day.mintemp_c
          : data.forecast.forecastday[0].day.mintemp_f,
        feelsLike: useCelsius ? data.current.feelslike_c : data.current.feelslike_f,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to fetch weather data: ${error}`);
    }
  }

  /**
   * Get weather for user's current location based on IP
   */
  static async getWeatherForCurrentLocation(
    useCelsius: boolean = true
  ): Promise<WeatherData> {
    // WeatherAPI supports "auto:ip" to automatically detect location
    return this.getWeather("auto:ip", useCelsius);
  }

  /**
   * Format weather data as a human-readable string
   */
  static formatWeather(weather: WeatherData, useCelsius: boolean = true): string {
    const unit = useCelsius ? "°C" : "°F";
    return [
      `Weather for ${weather.location}:`,
      `Currently ${weather.temperature}${unit} and ${weather.condition.toLowerCase()}`,
      `High: ${weather.high}${unit}, Low: ${weather.low}${unit}`,
    ].join("\n");
  }
}
