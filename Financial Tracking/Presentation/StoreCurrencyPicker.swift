import SwiftUI

/// A picker that controls the currency used for display across the app.
/// Stored as an optional to allow the picker sheet to be presented and dismissed.
struct StoreCurrencyPicker: Equatable {
    var selectedCurrencyCode: String
    var isPresented: Bool

    static let supportedCurrencies: [String] = [
        "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR"
    ]

    init(selectedCurrencyCode: String = "USD", isPresented: Bool = false) {
        self.selectedCurrencyCode = selectedCurrencyCode
        self.isPresented = isPresented
    }
}

struct CurrencyPickerSheet: View {
    @Binding var picker: StoreCurrencyPicker
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(StoreCurrencyPicker.supportedCurrencies, id: \.self) { currency in
                    Button {
                        picker.selectedCurrencyCode = currency
                        picker.isPresented = false
                        onDismiss()
                    } label: {
                        HStack {
                            Text(currency)
                                .fontWeight(.medium)
                            Spacer()
                            if currency == picker.selectedCurrencyCode {
                                Image(systemName: "checkmark")
                                    .foregroundColor(.blue)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Select Currency")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        picker.isPresented = false
                        onDismiss()
                    }
                }
            }
        }
    }
}
