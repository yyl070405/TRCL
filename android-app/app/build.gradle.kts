plugins {
    id("com.android.application")
}

android {
    namespace = "dev.mclauncher.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.mclauncher.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation(project(":core"))
}
