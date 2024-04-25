import md5 from "md5";
import * as path from 'path';
import PDFDocument from "pdfkit";
import { readFileSync } from "fs";


const Invoice = class {
    #netEqualsGross = true;
    #products = [];
    #footerText = "";
    #currency = undefined;
    #paid = 0;
    #netSum = 0;
    #grossSum = 0;

    #accentColor = '#444444';

    // payment information
    #iban;
    #bic;
    #accountName;
    #bankName;

    /**
     * Create a new Invoice.
     * After creating, call several functions to
     * @param {String} invoiceId ID of invoice 
     * @param {Date} invoiceDate Date when invoice was created
     * @param {Date} invoiceDueDate Date when Invoice is due
     * @param {String} vatId Vat ID
     * @param {String} locale Locale ("de", "en", ...)
     * @returns {Invoice} Basic invoice instance
    */
    constructor(invoiceId, invoiceDate, invoiceDueDate, vatId, locale) {
        this.invoiceId = invoiceId;
        this.invoiceDate = invoiceDate;
        this.invoiceDueDate = invoiceDueDate;
        this.vatId = vatId;
        this.locale = locale;
    };

    /**
     * Set Information of seller
     * @param {String} name Name (of business)
     * @param {String} street Street and Streetnumber
     * @param {String} zip Zip-Code
     * @param {String} city City
     * @param {String} country Country
     */
    setSeller(name, street, zip, city, country) {
        this.businessName = name;
        this.businessStreetAddress = street;
        this.businessZip = zip;
        this.businessCity = city;
        this.businessCountry = country;
    }

    /**
     * Set Information of buyer
     * @param {String} name Name (of client)
     * @param {String} street Street and Streetnumber
     * @param {String} zip Zip-Code
     * @param {String} city City
     * @param {String} country Country
     */
    setBuyer(name, street, zip, city, country) {
        this.clientName = name;
        this.clientStreetAddress = street;
        this.clientZip = zip;
        this.clientCity = city;
        this.clientCountry = country;
    }

    /**
     * Get translated word. Requires a locale to be set.
     * @param {String} key Key refers to key inside invoiceTranslations.json 
     * @returns {String} value
     */
    #translate(key) {
        if (!this.locale) {
            throw new Error("No locale is set for translations");
        }
        const location = path.resolve('json/invoiceTranslations.json');
        const translations = JSON.parse(readFileSync(location));

        // todo: lookup in file by key, throw error if it fails
        const languageTranslations = translations[this.locale];

        let translated = "No translation";
        Object.keys(languageTranslations).map((k) => {
            if (key === k) {
                translated = languageTranslations[key];
            }
        });

        return translated;
    }

    /**
     * Set currency of invoice
     * @param {String} currency Currency ("eur", "usd", "gbp", ...) 
     */
    setCurrency(currency) {
        currency = currency.toUpperCase();
        const location = path.resolve('json/commonCurrencies.json');
        const commonCurrenices = JSON.parse(readFileSync(location));

        this.#currency = commonCurrenices[currency];

        if (this.#currency === undefined) {
            throw new Error("Unable to find currency");
        }
    }

    /**
     * Add text to footer
     * @param {String} text Text to add to footer 
     */
    setFooter(text) {
        if (this.#netEqualsGross === true) {
            this.#footerText = this.#translate('NetEqualsGrossText');
        }
        else {
            this.#footerText = this.#translate('DefaultFooterText');
        }

        this.#footerText += text;
    }

    /**
     * Set payment information
     * @param {String} iban IBAN 
     * @param {String} name Account Name
     * @param {String} bic BIC 
     * @param {String} bankName Name of bank
     */
    setPaymentInfo(iban, name, bic, bankName, addToFooter = true) {
        if (this.#products.length === 0) {
            throw new Error("Please add products before setting PaymentInfo");
        }
        this.#iban = iban;
        this.#accountName = name;
        this.#bic = bic;
        this.#bankName = bankName;

        if (addToFooter) {
            this.setFooter(`<br>${this.#accountName} - ${this.#iban} - ${this.#bankName} - ${this.#bic}`);
        }
    }

    /**
     * Adds product to products, and orders it afterwards.
     * Not super efficient, but everything is always in order.
     * @param {String} title Title of product
     * @param {Number} netPrice Net price of product
     * @param {Number} vat Tax-rate of product
     * @param {Number} grossPrice Gross price of product
     */
    addProduct(title, netPrice, vat, grossPrice) {
        vat = Number(vat);
        if (vat > 0 && this.#netEqualsGross) {
            this.#netEqualsGross = false; // it is set to true, and potentially changes value to false once in a lifetime :P
        }

        // calculate md5 string as id
        const hash = md5(`${title}/${vat}/${netPrice}`);

        this.#products.push({
            md5: hash,
            description: title,
            "tax-rate": vat,
            netPrice: netPrice,
            grossPrice: grossPrice,
        });

        this.#grossSum += grossPrice;
        this.#netSum += netPrice;
    }

    /**
     * Run checks before generating pdf
     */
    #runChecks() {
        if (!this.#netEqualsGross && !this.vatId) {
            throw new Error("This invoice contains VAT, please include a valid VatID!");
        }
    }

    #filterProducts() {
        // categorize products
        this.#products.forEach((product) => {
            let quantity = 0;
            this.#products.forEach((product2) => {
                if (product.md5 === product2.md5) {
                    quantity++;
                }
            });
            product.quantity = quantity;
        });

        // remove duplicates from products array
        this.#products = this.#products.filter((product, index, self) =>
            index === self.findIndex((t) => (
                t.md5 === product.md5
            ))
        );
    }

    /**
     * Generate PDF.
     * Call this function in the end of the object's lifecycle.
     * @returns {String} Invoice as Base64 String
     */
    generatePDF() {
        this.#runChecks();
        this.#filterProducts();

        let doc = new PDFDocument({ size: "A4", margin: 50, compress: false });

        this.#generateHeader(doc);
        this.#generateCustomerInformation(doc);
        this.#generateInvoiceTable(doc);
        this.#generateFooter(doc);

        // const qrCodeLocation = await this.#generatePaymentQR();
        doc.end();

        return doc.read().toString("base64");
    }

    /**
     * Internal method to generate Header
     * @param {*} doc 
     */
    #generateHeader(doc) {
        doc
            // .image(invoice.imgBase64, 50, 45, { width: 50 })
            .fillColor("#444444")
            .fontSize(20)
            .font("Helvetica-Bold")
            .text(this.businessName, 50, 57)
            .font("Helvetica")
            .fontSize(10)
            .text(this.businessName, 200, 50, { align: "right" })
            .text(this.businessStreetAddress, 200, 65, { align: "right" })
            .text(this.businessCity + " " + this.businessZip + ", " + this.businessCountry, 200, 80, { align: "right" })
            .text(this.#translate("VatId") + ": " + this.vatId, 200, 95, { align: "right" })
            .moveDown();
    }

    /**
     * Internal method to generate Customer Information
     * @param {*} doc 
     */
    #generateCustomerInformation(doc) {
        doc
            .fillColor("#444444")
            .fontSize(20)
            .text(this.#translate("Invoice"), 50, 160);

        this.#generateHr(doc, 183);

        const customerInformationTop = 197;

        doc
            .fontSize(10)
            .text(this.#translate("InvoiceNr"), 50, customerInformationTop)
            .font("Helvetica-Bold")
            .text(this.invoiceId, 150, customerInformationTop)
            .font("Helvetica")
            .text(this.#translate("InvoiceDate"), 50, customerInformationTop + 15)
            .text(this.formatDate(new Date(this.invoiceDate)), 150, customerInformationTop + 15)
            .text(`${this.#translate("BalanceDue")}:`, 50, customerInformationTop + 30)
            .text(
                this.formatCurrency(this.#grossSum - this.#paid),
                150,
                customerInformationTop + 30
            )

            .font("Helvetica-Bold")
            .text(this.clientName, 300, customerInformationTop)
            .font("Helvetica")
            .text(this.clientStreetAddress, 300, customerInformationTop + 21)
            .text(
                this.clientZip +
                ", " +
                this.clientCity +
                ", " +
                this.clientCountry,
                300,
                customerInformationTop + 32
            )
            .moveDown();

        this.#generateHr(doc, 250);
    }

    /**
     * Internal method to generate invoice table
     * @param {*} doc 
     */
    #generateInvoiceTable(doc) {
        let i;
        const invoiceTableTop = 325;

        doc.font("Helvetica-Bold");
        this.#generateTableRow(
            doc,
            invoiceTableTop,
            this.#translate("Item"),
            this.#translate("Net"),
            this.#translate("Total")
        );
        this.#generateHr(doc, invoiceTableTop + 20);
        doc.font("Helvetica");

        for (i = 0; i < this.#products.length; i++) {
            const product = this.#products[i];
            const position = invoiceTableTop + (i + 1) * 30;
            this.#generateTableRow(
                doc,
                position,
                product.quantity + "x " + product.description,
                this.formatCurrency(product.netPrice * product.quantity),
                this.formatCurrency(product.grossPrice * product.quantity)
            );

            this.#generateHr(doc, position + 20);
        }

        const subtotalPosition = invoiceTableTop + (i + 1) * 30;
        doc.font("Helvetica-Bold");

        this.#generateTableRow(
            doc,
            subtotalPosition,
            this.#translate("Sum"),
            this.formatCurrency(this.#netSum),
            this.formatCurrency(this.#grossSum),
            this.formatCurrency(this.#grossSum)
        );

        doc.font("Helvetica");
    }

    /**
     * Internal method to generate footer
     * @param {*} doc 
     */
    #generateFooter(doc) {
        const lines = this.#footerText.split("<br>");

        let y = 735;

        lines.forEach((line) => {
            doc
                .fontSize(10)
                .text(
                    line,
                    50,
                    y,
                    { align: "center", width: 500 }
                );
            y += 15;
        })
    }

    #generateTableRow(doc, y, title, unitCost, lineTotal) {
        doc
            .fontSize(10)
            .text(title, 50, y)
            .text(unitCost, 390, y, { width: 90, align: "right" })
            .text(lineTotal, 0, y, { align: "right" });
    }

    #generateHr(doc, y) {
        doc
            .strokeColor("#aaaaaa")
            .lineWidth(1)
            .moveTo(50, y)
            .lineTo(550, y)
            .stroke();
    }

    /**
     * Format a number to currency
     * @param {Number | String} amount for example 2.12001 
     * @returns {String} for example €2.12
     */
    formatCurrency(amount) {
        return this.#currency.symbol + Number(amount).toFixed(2);
    }

    /**
     * Format date
     * @param {Date} date 
     * @returns {String} beautiful date
     */
    formatDate(date) {
        if (!(date instanceof Date)) {
            throw new Error("Please supply date obj. to formatDate() #invoicejs");
        }

        return date.getDate() +
            "." +
            (date.getMonth() + 1) +
            "." +
            date.getFullYear();

    }

}

export default Invoice