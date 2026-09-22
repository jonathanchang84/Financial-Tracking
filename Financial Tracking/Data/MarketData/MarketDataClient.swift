import Foundation

struct QuoteResponse: Codable, Sendable {
    let symbol: String
    let price: Decimal
    let currencyCode: String
    let observedAt: Date
}

protocol MarketDataClient: Sendable {
    func quote(for symbol: String) async throws -> QuoteResponse
}

struct ProxyMarketDataClient: MarketDataClient {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func quote(for symbol: String) async throws -> QuoteResponse {
        let url = baseURL.appendingPathComponent("v1/quotes/\(symbol)")
        let (data, response) = try await session.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(QuoteResponse.self, from: data)
    }
}