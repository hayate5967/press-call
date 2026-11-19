// 小さな JSON の読み取り（設定・ペアリングの応答で共通に使う）
// 応答は小さく形も決まっているので、ライブラリを使わずに必要なぶんだけ読む。
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>

namespace presscall::json {

class Reader {
public:
    explicit Reader(const std::string& s) : s_(s) {}

    void skipWs() {
        while (pos_ < s_.size() && (s_[pos_] == ' ' || s_[pos_] == '\t' || s_[pos_] == '\n' ||
                                    s_[pos_] == '\r')) {
            ++pos_;
        }
    }

    bool consume(char c) {
        skipWs();
        if (pos_ < s_.size() && s_[pos_] == c) {
            ++pos_;
            return true;
        }
        return false;
    }

    bool peek(char c) {
        skipWs();
        return pos_ < s_.size() && s_[pos_] == c;
    }

    bool atEnd() {
        skipWs();
        return pos_ == s_.size();
    }

    bool literal(const char* word) {
        skipWs();
        const size_t n = std::strlen(word);
        if (s_.compare(pos_, n, word) != 0) return false;
        pos_ += n;
        return true;
    }

    // 文字列。このファームで読む値は ASCII だけなので、\uXXXX は読み飛ばすだけにする
    bool string(std::string& out) {
        if (!consume('"')) return false;
        out.clear();
        while (pos_ < s_.size()) {
            const char c = s_[pos_++];
            if (c == '"') return true;
            if (c == '\\') {
                if (pos_ >= s_.size()) return false;
                const char e = s_[pos_++];
                if (e == 'u') {
                    if (pos_ + 4 > s_.size()) return false;
                    pos_ += 4;
                    out += '?';
                } else {
                    out += e;
                }
            } else {
                out += c;
            }
        }
        return false;
    }

    bool number(double& out) {
        skipWs();
        const char* begin = s_.c_str() + pos_;
        char* end = nullptr;
        out = std::strtod(begin, &end);
        if (end == begin) return false;
        pos_ += static_cast<size_t>(end - begin);
        return std::isfinite(out);
    }

    // 知らないキーの値を読み飛ばす
    bool skipValue(int depth = 0) {
        if (depth > 8) return false;
        std::string dummyS;
        double dummyN;
        if (peek('"')) return string(dummyS);
        if (peek('{') || peek('[')) {
            const char close = peek('{') ? '}' : ']';
            const bool isObject = close == '}';
            consume(isObject ? '{' : '[');
            if (consume(close)) return true;
            do {
                if (isObject && !(string(dummyS) && consume(':'))) return false;
                if (!skipValue(depth + 1)) return false;
            } while (consume(','));
            return consume(close);
        }
        if (literal("true") || literal("false") || literal("null")) return true;
        return number(dummyN);
    }

private:
    const std::string& s_;
    size_t pos_ = 0;
};

}  // namespace presscall::json
